// Dynamic import also works with a previously cached classic-script index.html.
// All application logic lives in native ES modules; nothing is put on window.
import("./src/app.js")
  .then(({ createApp }) => createApp())
  .catch((error) => {
    console.error("Sur could not initialize", error);
    const status = document.getElementById("status");
    if (status) {
      status.textContent = "Player could not load. Stay online, reload, and try again.";
      status.classList.toggle("error", true);
    }
  });
