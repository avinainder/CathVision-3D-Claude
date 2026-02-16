export function captureScreenshot(renderer, angles) {
  const hLabel = angles.horizontal.label;
  const hVal = angles.horizontal.value.toFixed(1);
  const vLabel = angles.vertical.label;
  const vVal = angles.vertical.value.toFixed(1);

  const filename = `coronary_${hLabel}${hVal}_${vLabel}${vVal}.png`;

  const dataURL = renderer.domElement.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = dataURL;
  link.download = filename;
  link.click();

  return filename;
}
