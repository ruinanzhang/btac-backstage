const zone = document.querySelector("[data-auto-zone]");
if (zone) zone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;

const countdown = document.querySelector("[data-countdown]");
if (countdown) {
  const opensAt = Number(countdown.dataset.countdown);
  const serverOffset = Number(countdown.dataset.now) - Date.now();
  const cells = [...countdown.querySelectorAll("[data-segment]")];
  const update = () => {
    const seconds = Math.max(0, Math.ceil((opensAt - Date.now() - serverOffset) / 1000));
    const values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24,
      Math.floor(seconds / 60) % 60, seconds % 60];
    cells.forEach((cell, index) => { cell.textContent = String(values[index]).padStart(2, "0"); });
    if (seconds === 0) window.location.reload();
  };
  update();
  setInterval(update, 1000);
}

const copyStatus = document.querySelector("[data-copy-status]");
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied";
      if (copyStatus) copyStatus.textContent = "Share link copied.";
      setTimeout(() => { button.textContent = "Copy link"; }, 1400);
    } catch {
      window.prompt("Copy this share link", button.dataset.copy);
    }
  });
}
