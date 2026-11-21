const presaleDetails = `
  SELECT p.*, b.slug AS band_slug, b.name AS band_name, b.accent
  FROM presales p JOIN bands b ON b.id = p.band_id
`;

export function createStore(db) {
  const query = (sql, ...values) => db.prepare(sql).bind(...values);
  const first = (sql, ...values) => query(sql, ...values).first();
  const run = (sql, ...values) => query(sql, ...values).run();
  const all = async (sql, ...values) => (await query(sql, ...values).all()).results;

  return {
    bands: (owner) => all("SELECT * FROM bands WHERE owner_id = ? ORDER BY created_at", owner),
    band: (owner, slug) => first("SELECT * FROM bands WHERE owner_id = ? AND slug = ?", owner, slug),
    createBand: (id, owner, slug, name, accent, now) => query(`
      INSERT INTO bands (id, owner_id, slug, name, accent, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (slug) DO NOTHING RETURNING id
    `, id, owner, slug, name, accent, now).first(),

    presales: (band) => all(`
      SELECT p.*,
        (SELECT COUNT(*) FROM signups s WHERE s.presale_id = p.id) AS signups,
        (SELECT COUNT(*) FROM clicks c WHERE c.presale_id = p.id) AS clicks
      FROM presales p WHERE p.band_id = ? ORDER BY p.created_at DESC
    `, band),
    presale: (band, slug) => first("SELECT * FROM presales WHERE band_id = ? AND slug = ?", band, slug),
    createPresale: (id, band, slug, data, now) => query(`
      INSERT INTO presales
        (id, band_id, slug, title, venue, description, event_at, opens_at, timezone, ticket_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (band_id, slug) DO NOTHING RETURNING id
    `, id, band, slug, data.title, data.venue, data.description, data.eventAt, data.opensAt, data.timezone, data.ticketUrl, now).first(),
    editPresale: (presale, data, now) => query(`
      UPDATE presales SET title = ?, venue = ?, description = ?, event_at = ?, opens_at = ?, timezone = ?, ticket_url = ?
      WHERE id = ? AND (published_at IS NULL OR (opens_at > ? AND ? > ?)) RETURNING id
    `, data.title, data.venue, data.description, data.eventAt, data.opensAt, data.timezone, data.ticketUrl, presale, now, data.opensAt, now).first(),
    publish: (presale, now) => query(`
      UPDATE presales SET published_at = ?
      WHERE id = ? AND published_at IS NULL AND opens_at > ? RETURNING id
    `, now, presale, now).first(),
    publicPresale: (band, slug) => first(`${presaleDetails} WHERE b.slug = ? AND p.slug = ? AND p.published_at IS NOT NULL`, band, slug),

    partner: (presale, code) => first("SELECT id, code FROM partners WHERE presale_id = ? AND code = ?", presale, code),
    addPartner: (id, presale, code, name, now) => query(`
      INSERT INTO partners (id, presale_id, code, name, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (presale_id, code) DO NOTHING RETURNING id
    `, id, presale, code, name, now).first(),
    stats: async (presale) => {
      const results = await db.batch([
        query(`
          SELECT COUNT(*) AS signups, COUNT(updates_opt_in_at) AS updates,
            COUNT(CASE WHEN delivery = 'sent' THEN 1 END) AS sent,
            COUNT(CASE WHEN delivery = 'failed' THEN 1 END) AS failed
          FROM signups WHERE presale_id = ?
        `, presale),
        query(`
          SELECT id, name, code,
            (SELECT COUNT(*) FROM signups s WHERE s.presale_id = ? AND s.partner_id = p.id) AS signups,
            (SELECT COUNT(*) FROM clicks c WHERE c.presale_id = ? AND c.partner_id = p.id) AS clicks
          FROM partners p WHERE p.presale_id = ? ORDER BY created_at, name
        `, presale, presale, presale),
        query(`
          SELECT COUNT(*) AS clicks, COUNT(CASE WHEN partner_id IS NULL THEN 1 END) AS direct_clicks,
            (SELECT COUNT(*) FROM signups WHERE presale_id = ? AND partner_id IS NULL) AS direct_signups
          FROM clicks WHERE presale_id = ?
        `, presale, presale),
      ]);
      const [totals, partners, clicks] = results.map((result) => result.results);
      return { ...totals[0], ...clicks[0], partners };
    },
    signup: (id, presale, email, partner, updates, token, now) => query(`
      INSERT INTO signups (id, presale_id, partner_id, email, consented_at, updates_opt_in_at, ticket_token)
      SELECT ?, p.id, ?, ?, ?, ?, ? FROM presales p
      WHERE p.id = ? AND p.published_at IS NOT NULL AND p.opens_at > ?
      ON CONFLICT (presale_id, email) DO NOTHING RETURNING id
    `, id, partner, email, now, updates ? now : null, token, presale, now).first(),
    ticketForSignup: (token) => first(`
      SELECT p.id, p.ticket_url, p.opens_at, p.event_at, s.partner_id
      FROM signups s JOIN presales p ON p.id = s.presale_id
      WHERE s.ticket_token = ? AND p.published_at IS NOT NULL
    `, token),
    recordClick: (presale, partner, now) => run(`
      INSERT INTO clicks (id, presale_id, partner_id, clicked_at) VALUES (?, ?, ?, ?)
    `, crypto.randomUUID(), presale, partner, now),

    expireLeases: (now, oldestRetry) => run(`
      UPDATE signups SET delivery = 'failed', lease_id = NULL
      WHERE delivery IN ('pending', 'sending') AND next_attempt_at <= ?
        AND first_attempt_at <= ?
    `, now, oldestRetry),
    due: (now, limit) => all(`
      SELECT s.id, s.email, s.ticket_token, s.attempts, p.title, b.name AS band_name
      FROM signups s JOIN presales p ON p.id = s.presale_id JOIN bands b ON b.id = p.band_id
      WHERE p.published_at IS NOT NULL AND p.opens_at <= ? AND p.event_at > ?
        AND s.delivery IN ('pending', 'sending') AND s.next_attempt_at <= ?
      ORDER BY p.opens_at, s.consented_at LIMIT ?
    `, now, now, now, limit),
    claim: (id, leaseId, now, until) => query(`
      UPDATE signups SET delivery = 'sending', attempts = attempts + 1,
        first_attempt_at = COALESCE(first_attempt_at, ?), lease_id = ?, next_attempt_at = ?
      WHERE id = ? AND delivery IN ('pending', 'sending') AND next_attempt_at <= ?
      RETURNING attempts
    `, now, leaseId, until, id, now).first(),
    complete: (id, leaseId, now) => run(`
      UPDATE signups SET delivery = 'sent', sent_at = ?, lease_id = NULL
      WHERE id = ? AND lease_id = ?
    `, now, id, leaseId),
    retry: (id, leaseId, state, nextAt) => run(`
      UPDATE signups SET delivery = ?, next_attempt_at = ?, lease_id = NULL
      WHERE id = ? AND lease_id = ?
    `, state, nextAt, id, leaseId),
  };
}
