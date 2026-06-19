/**
 * Triggers a browser download of a Blob via a temporary object URL and a
 * hidden anchor click, then revokes the URL.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after a tick so the download has begun.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
