import { request, showStatus, busy, element } from "./shared.js";

const refresh = document.getElementById("refresh");
async function load() {
  await busy(refresh, async () => {
    showStatus("status", "Loading current health…");
    try {
      const [metrics, operations] = await Promise.all([request("/metrics"), request("/operations")]);
      const rows = [
        ["ERP", metrics.erp], ["PM", metrics.pm],
        ["Last complete snapshot", metrics.last_complete_snapshot ?? "No complete snapshot yet"],
        ["Last successful sync", metrics.last_successful_sync ?? "No successful sync yet"],
        ["Pending / retrying / failed jobs", `${metrics.jobs.pending ?? 0} / ${metrics.jobs.retrying ?? 0} / ${metrics.jobs.failed ?? 0}`],
        ["Sync lag (seconds)", metrics.sync_lag_seconds], ["Unresolved drift", metrics.drift_count],
      ];
      const list = document.getElementById("metrics");
      list.replaceChildren(...rows.flatMap(([name, value]) => [element("dt", name), element("dd", value)]));
      const body = document.getElementById("operations");
      body.replaceChildren();
      for (const operation of operations) {
        const row = document.createElement("tr");
        const link = element("a", operation.operation_id);
        link.href = `/operations.html?operation_id=${encodeURIComponent(operation.operation_id)}`;
        const cell = document.createElement("td"); cell.append(link); row.append(cell);
        for (const key of ["action", "version", "status"]) row.append(element("td", operation[key]));
        body.append(row);
      }
      if (!operations.length) {
        const row = document.createElement("tr"); const cell = element("td", "No operations yet. Seed the ERP and run a snapshot poll.");
        cell.colSpan = 4; row.append(cell); body.append(row);
      }
      showStatus("status", "Health refreshed. Timestamps are shown in UTC.");
    } catch (error) { showStatus("status", `${error.message} Start the API and database, then refresh.`, true); }
  });
}
refresh.addEventListener("click", load);
load();
