// Formulario PDF rellenable: solicitud de número de SOL CASH (español / kreyòl).
// Un solo diseño: usa el mismo módulo que la ruta GET /sanes/formulario
// (src/sanes/formulario-pdf.ts, ya compilado en dist/).
// Uso (desde backend/, con el backend compilado): node scripts/formulario-san.js [salida.pdf]
const fs = require('fs');
const path = require('path');

let modulo;
try {
  modulo = require(path.resolve(__dirname, '..', 'dist', 'sanes', 'formulario-pdf'));
} catch {
  console.error('No encontré dist/sanes/formulario-pdf.js: compile primero el backend (npm run build).');
  process.exit(1);
}

const salida =
  process.argv[2] || path.resolve(__dirname, '..', '..', 'docs', 'formularios', 'SOL-CASH-solicitud-de-numero.pdf');
modulo
  .generarFormularioSan({ empresa: 'SCITO ENTREPRISE' })
  .then((pdf) => {
    fs.writeFileSync(salida, pdf);
    console.log('PDF creado:', salida);
  })
  .catch((e) => {
    console.error('No se pudo crear el PDF:', e.message);
    process.exit(1);
  });
