export interface CoordinationShortcutFile {
  filename: string;
  content: string;
}

export function buildCoordinationShortcut(
  projectName: string,
  url: string,
  userAgent: string,
): CoordinationShortcutFile {
  const name = projectName.replace(/[^\w\s-]/g, "").trim() || "Coordination Sheet";
  const ua = userAgent.toLowerCase();
  const isMac = ua.includes("mac") && !ua.includes("iphone") && !ua.includes("ipad");

  if (isMac) {
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>URL</key>\n\t<string>${url}</string>\n</dict>\n</plist>`;
    return { filename: `${name}.webloc`, content };
  }

  return {
    filename: `${name}.url`,
    content: `[InternetShortcut]\nURL=${url}\n`,
  };
}

export function downloadCoordinationShortcut(shortcut: CoordinationShortcutFile): void {
  const blob = new Blob([shortcut.content], { type: "application/octet-stream" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = shortcut.filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can interrupt Blob downloads in some browsers, leaving
  // the temporary file with a `.download` suffix instead of the shortcut extension.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
