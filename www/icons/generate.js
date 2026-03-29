// Generate PNG icons from canvas
// Run: node generate.js (requires canvas module, or use the HTML version in browser)

const fs = require('fs');
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

// Since we can't use canvas in Node without native deps,
// generate a simple script that creates a self-contained HTML
// that auto-downloads all icons when opened in browser

const html = `<!DOCTYPE html><html><body>
<h2>Peakflow Icons - Rechtsklick > Speichern unter</h2>
<script>
const sizes = [${sizes.join(',')}];
sizes.forEach(size => {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const x = c.getContext('2d');
  const r = size * 0.18;
  x.beginPath(); x.roundRect(0,0,size,size,r); x.fillStyle='#1a1a1a'; x.fill();
  const cx = size/2, mT = size*0.18, mB = size*0.72, mW = size*0.32;
  x.beginPath(); x.moveTo(cx,mT); x.lineTo(cx+mW,mB); x.lineTo(cx-mW,mB); x.closePath();
  x.fillStyle='#c9a84c'; x.fill();
  const sH = size*0.12;
  x.beginPath(); x.moveTo(cx,mT); x.lineTo(cx+sH*0.8,mT+sH); x.lineTo(cx+sH*0.3,mT+sH*0.85);
  x.lineTo(cx-sH*0.3,mT+sH*0.85); x.lineTo(cx-sH*0.8,mT+sH); x.closePath();
  x.fillStyle='#fff'; x.fill();
  if(size>=128){x.fillStyle='#f0ece2';x.font='bold '+size*0.1+'px Arial';x.textAlign='center';x.fillText('Peakflow',cx,size*0.88);}
  const img = document.createElement('img');
  img.src = c.toDataURL('image/png');
  img.style.width = Math.min(size,128)+'px';
  img.style.margin = '8px';
  img.title = 'icon-'+size+'.png';
  document.body.appendChild(img);
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = 'icon-'+size+'.png';
  a.click();
});
<\/script></body></html>`;

fs.writeFileSync('download-icons.html', html);
console.log('Open download-icons.html in Chrome to generate all icons');
</script>
