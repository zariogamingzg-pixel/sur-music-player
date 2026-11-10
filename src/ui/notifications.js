export function createNotifications(document) {
  const status = document.getElementById("status");
  return (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
}
