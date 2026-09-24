// @ts-check
/** @typedef {{id:string,subject:string,body:string,version:number,status:string,priority:string}} TicketSummary */
/** @typedef {{data:TicketSummary[],page:number,total:number,totalPages:number}} TicketPage */
/** @param {string} url @param {RequestInit} [options] @returns {Promise<any>} */
async function apiRequest(url, options = {}) {
  const response = await apiFetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
}
/** @param {string} url @param {RequestInit} [options] @returns {Promise<Response>} */
async function apiFetch(url, options = {}) {
  const token = sessionStorage.getItem("hd_token");
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", "Bearer " + token);
  if (typeof options.body === "string")
    headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(30000),
  });
  if (response.status === 401) {
    sessionStorage.removeItem("hd_token");
    sessionStorage.removeItem("hd_user");
    location.reload();
    throw new Error("Session expired");
  }
  return response;
}
/** @param {unknown} value @returns {TicketPage} */
function validateTicketPage(value) {
  const page = /** @type {TicketPage} */ (value);
  if (
    !page ||
    !Array.isArray(page.data) ||
    !Number.isInteger(page.total) ||
    !Number.isInteger(page.totalPages) ||
    page.data.some(
      (ticket) =>
        typeof ticket.id !== "string" || typeof ticket.subject !== "string",
    )
  )
    throw new Error("Invalid ticket list response");
  return page;
}
