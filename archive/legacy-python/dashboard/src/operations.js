import { request, showStatus, busy, element } from "./shared.js";

const input = document.getElementById("operation-id");
input.value = new URLSearchParams(location.search).get("operation_id") ?? "";
async function load(event) {
  event?.preventDefault();
  const id = input.value.trim();
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    input.setAttribute("aria-invalid", "true"); input.focus();
    showStatus("status", "Enter a valid operation UUID.", true); return;
  }
  input.removeAttribute("aria-invalid");
  await busy(document.querySelector("#lookup button"), async () => {
    showStatus("status", "Loading operation…");
    try {
      const [operation, events] = await Promise.all([request(`/operations/${id}`), request(`/operations/${id}/timeline`)]);
      history.replaceState(null, "", `?operation_id=${encodeURIComponent(id)}`);
      document.getElementById("summary").textContent = JSON.stringify(operation, null, 2);
      document.getElementById("timeline").replaceChildren(...events.map(item => element("li", `${item.created_at} · ${item.event} · ${JSON.stringify(item.detail)}`)));
      showStatus("status", events.length ? "Timeline loaded. Showing up to 100 audit events." : "No audit events recorded yet.");
    } catch (error) { showStatus("status", `${error.message} Check the ID and try again.`, true); }
  });
}
document.getElementById("lookup").addEventListener("submit", load);
if (input.value) load();

document.getElementById("chaos").addEventListener("submit", async event => {
  event.preventDefault();
  const field = document.getElementById("seed"); const seed = Number(field.value);
  if (!field.value || !Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) {
    field.setAttribute("aria-invalid", "true"); field.focus();
    showStatus("chaos-status", "Enter an integer seed from 0 to 2147483647.", true); return;
  }
  field.removeAttribute("aria-invalid");
  await busy(document.querySelector("#chaos button"), async () => {
    showStatus("chaos-status", "Creating plan…");
    try {
      const result = await request("/chaos/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seed }) });
      document.getElementById("chaos-result").textContent = JSON.stringify(result, null, 2);
      showStatus("chaos-status", "Plan recorded. Invariants have not been executed.");
    } catch (error) { showStatus("chaos-status", `${error.message} Try again.`, true); }
  });
});
