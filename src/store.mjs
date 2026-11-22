const presaleDetails = `
  SELECT p.*, b.slug AS band_slug, b.name AS band_name, b.accent
  FROM presales p JOIN bands b ON b.id = p.band_id
`;

export function createStore(db) {
  const query = (sql, ...values) => db.prepare(sql).bind(...values);
  const first = (sql, ...values) => query(sql, ...values).first();
  const run = (sql, ...values) => query(sql, ...values).run();
  const all = async (sql, ...values) => (await query(sql, ...values).all()).results;

  function deliveryQueue(channel) {
    const text = channel === "text";
    const table = text ? "text_signups" : "signups";
    const address = text ? "phone" : "email";
    // Only email jobs can resume an expired lease. The email provider deduplicates retries.
    const eligible = text ? "('pending')" : "('pending', 'sending')";
    const expiredText = text ? "OR delivery = 'sending'" : "";
    return {
      expireLeases: (now, oldestRetry) => run(`
        UPDATE ${table} SET delivery = 'failed', lease_id = NULL
        WHERE next_attempt_at <= ? AND
          ((delivery IN ${eligible} AND first_attempt_at <= ?) ${expiredText})
      `, now, oldestRetry),
      due: (now, limit) => all(`
        SELECT s.id, s.${address}, s.ticket_token, p.title, b.name AS band_name
        FROM ${table} s JOIN presales p ON p.id = s.presale_id JOIN bands b ON b.id = p.band_id
        WHERE p.published_at IS NOT NULL AND p.opens_at <= ? AND p.event_at > ?
          AND s.delivery IN ${eligible} AND s.next_attempt_at <= ?
        ORDER BY p.opens_at, s.consented_at LIMIT ?
      `, now, now, now, limit),
      claim: (id, leaseId, now, until) => first(`
        UPDATE ${table} SET delivery = 'sending', attempts = attempts + 1,
          first_attempt_at = COALESCE(first_attempt_at, ?), lease_id = ?, next_attempt_at = ?
        WHERE id = ? AND delivery IN ${eligible} AND next_attempt_at <= ?
        RETURNING attempts
      `, now, leaseId, until, id, now),
      complete: (id, leaseId, now) => run(`
        UPDATE ${table} SET delivery = 'sent', sent_at = ?, lease_id = NULL
        WHERE id = ? AND lease_id = ?
      `, now, id, leaseId),
      retry: (id, leaseId, state, nextAt) => run(`
        UPDATE ${table} SET delivery = ?, next_attempt_at = ?, lease_id = NULL
        WHERE id = ? AND lease_id = ?
      `, state, nextAt, id, leaseId),
    };
  }

  return {
    bands: (owner) => all("SELECT * FROM bands WHERE owner_id = ? ORDER BY created_at", owner),
    band: (owner, slug) => first("SELECT * FROM bands WHERE owner_id = ? AND slug = ?", owner, slug),
    createBand: (id, owner, slug, name, accent, now) => query(`
      INSERT INTO bands (id, owner_id, slug, name, accent, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (slug) DO NOTHING RETURNING id
    `, id, owner, slug, name, accent, now).first(),

    presales: (band) => all(`
      SELECT p.*,
        (SELECT COUNT(*) FROM fan_signups s WHERE s.presale_id = p.id) AS signups,
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
    updateTicketUrl: (presale, url, now) => first(`
      UPDATE presales SET ticket_url = ?
      WHERE id = ? AND published_at IS NOT NULL AND event_at > ? RETURNING id
    `, url, presale, now),
    publicPresale: (band, slug) => first(`${presaleDetails} WHERE b.slug = ? AND p.slug = ? AND p.published_at IS NOT NULL`, band, slug),

    partner: (presale, code) => first("SELECT id, code FROM partners WHERE presale_id = ? AND code = ?", presale, code),
    addPartner: (id, presale, code, name, now) => query(`
      INSERT INTO partners (id, presale_id, code, name, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (presale_id, code) DO NOTHING RETURNING id
    `, id, presale, code, name, now).first(),
    stats: async (presale) => {
      const results = await db.batch([
        query(`
          SELECT COUNT(*) AS signups, COUNT(CASE WHEN updates_opted_in THEN 1 END) AS updates
          FROM fan_signups WHERE presale_id = ?
        `, presale),
        query(`
          SELECT id, name, code,
            (SELECT COUNT(*) FROM fan_signups s WHERE s.presale_id = ? AND s.partner_id = p.id) AS signups,
            (SELECT COUNT(*) FROM clicks c WHERE c.presale_id = ? AND c.partner_id = p.id) AS clicks
          FROM partners p WHERE p.presale_id = ? ORDER BY created_at, name
        `, presale, presale, presale),
        query(`
          SELECT COUNT(*) AS clicks, COUNT(CASE WHEN partner_id IS NULL THEN 1 END) AS direct_clicks,
            (SELECT COUNT(*) FROM fan_signups WHERE presale_id = ? AND partner_id IS NULL) AS direct_signups
          FROM clicks WHERE presale_id = ?
        `, presale, presale),
        ...["signups", "text_signups"].map((table) => query(`
          SELECT COUNT(*) AS recipients, COUNT(CASE WHEN delivery = 'sent' THEN 1 END) AS sent,
            COUNT(CASE WHEN delivery = 'failed' THEN 1 END) AS failed
          FROM ${table} WHERE presale_id = ?
        `, presale)),
      ]);
      const [totals, partners, clicks, email, text] = results.map((result) => result.results);
      return { ...totals[0], ...clicks[0], partners, delivery: {email:email[0], text:text[0]} };
    },
    signup: (presale, partner, {email, phone, emailUpdates, textUpdates}, now) => {
      const writes = [];
      if (email) {
        const id = crypto.randomUUID();
        writes.push(query(`
          INSERT INTO signups (id, presale_id, partner_id, email, consented_at, updates_opt_in_at, ticket_token)
          SELECT ?, p.id, CASE WHEN t.id IS NULL THEN ? ELSE t.partner_id END, ?, ?, ?, ?
          FROM presales p LEFT JOIN text_signups t
            ON t.presale_id = p.id AND t.phone = ? AND t.email_signup_id IS NULL
          WHERE p.id = ? AND p.published_at IS NOT NULL AND p.opens_at > ?
          ON CONFLICT (presale_id, email) DO NOTHING
        `, id, partner, email, now, emailUpdates ? now : null, crypto.randomUUID(), phone, presale, now));
        if (phone) {
          // Merge a prior text-only registration when this submission adds its email for the first time.
          writes.push(query(`
            UPDATE text_signups SET email_signup_id = ?
            WHERE presale_id = ? AND phone = ? AND email_signup_id IS NULL
              AND EXISTS (SELECT 1 FROM signups WHERE id = ?)
          `, id, presale, phone, id));
        }
      }
      if (phone) {
        writes.push(query(`
          INSERT INTO text_signups
            (id, presale_id, partner_id, email_signup_id, phone, consented_at, updates_opt_in_at, ticket_token)
          SELECT ?, p.id, CASE WHEN e.id IS NULL THEN ? ELSE e.partner_id END, e.id, ?, ?, ?, ?
          FROM presales p LEFT JOIN signups e ON e.presale_id = p.id AND e.email = ?
            AND NOT EXISTS (SELECT 1 FROM text_signups WHERE email_signup_id = e.id)
          WHERE p.id = ? AND p.published_at IS NOT NULL AND p.opens_at > ?
          ON CONFLICT (presale_id, phone) DO NOTHING
        `, crypto.randomUUID(), partner, phone, now, textUpdates ? now : null, crypto.randomUUID(), email, presale, now));
      }
      return db.batch(writes);
    },
    ticketForSignup: (token) => first(`
      SELECT p.id, p.ticket_url, p.opens_at, p.event_at, s.partner_id
      FROM (
        SELECT presale_id, partner_id FROM signups WHERE ticket_token = ?
        UNION ALL
        SELECT presale_id, partner_id FROM text_signups WHERE ticket_token = ?
      ) s JOIN presales p ON p.id = s.presale_id WHERE p.published_at IS NOT NULL
    `, token, token),
    recordClick: (presale, partner, now) => run(`
      INSERT INTO clicks (id, presale_id, partner_id, clicked_at) VALUES (?, ?, ?, ?)
    `, crypto.randomUUID(), presale, partner, now),

    queues: { email: deliveryQueue("email"), text: deliveryQueue("text") },
  };
}
