export async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${response.status}).`);
  }
  return response.json();
}

export function showStatus(id, message, failed = false) {
  const node = document.getElementById(id);
  node.textContent = message;
  node.classList.toggle("error", failed);
}

export async function busy(button, action) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try { await action(); } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

export function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = String(text ?? "—");
  return node;
}
