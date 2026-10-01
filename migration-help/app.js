const form = document.getElementById("enquiry");
const status = document.getElementById("formStatus");
const draft = document.getElementById("draft");
const fallback = document.getElementById("fallback");
const fallbackLabel = document.getElementById("fallbackLabel");

function resetDraft() {
  draft.hidden = true;
  draft.removeAttribute("href");
  fallbackLabel.hidden = true;
  fallback.value = "";
  status.textContent = "";
}

form.addEventListener("input", resetDraft);
form.addEventListener("change", resetDraft);
form.addEventListener("invalid", (event) => {
  event.target.setAttribute("aria-invalid", "true");
}, true);
form.addEventListener("input", (event) => event.target.removeAttribute("aria-invalid"));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  resetDraft();
  const layout = document.getElementById("layout").value.trim();
  if (layout.length < 10) {
    status.textContent = "Describe the layout using at least 10 non-blank characters.";
    document.getElementById("layout").setAttribute("aria-invalid", "true");
    return;
  }
  for (const control of form.elements) control.removeAttribute("aria-invalid");
  const subject = "Xray migration pilot enquiry";
  const body = `Xray edition: ${document.getElementById("edition").value}\nApproximate tests: ${document.getElementById("count").value}\n\nLayout / column names:\n${layout}\n\nI understand this is a pilot enquiry, not a purchase or a promise of compatibility. No confidential sample or credentials are included.`;
  draft.href = `mailto:dilojbusiness@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  draft.hidden = false;
  fallback.value = `To: dilojbusiness@gmail.com\nSubject: ${subject}\n\n${body}`;
  fallbackLabel.hidden = false;
  status.textContent = "Draft ready. Review it before sending. Nothing has been sent by this website.";
});