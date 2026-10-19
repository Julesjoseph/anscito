// Formulario PDF rellenable: solicitud de número de SOL CASH (español / kreyòl).
// Los campos coinciden con la ficha de ANSCITO (san_fichas, san_garantes, terceros).
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// Uso (desde backend/): node scripts/formulario-san.js
const salida = process.argv[2] || path.resolve(__dirname, '..', '..', 'docs', 'formularios', 'SOL-CASH-solicitud-de-numero.pdf');
const doc = new PDFDocument({ size: 'LETTER', margins: { top: 40, bottom: 40, left: 42, right: 42 }, info: { Title: 'SOL CASH - Solicitud de número', Author: 'SCITO ENTREPRISE' } });
doc.pipe(fs.createWriteStream(salida));
doc.initForm();

const ROJO = '#C8102E';
const GRIS = '#555555';
const X0 = 42;
const ANCHO = 612 - 84;
let y = 40;
const espacio = (h) => { if (y + h > 752) { doc.addPage(); y = 40; } };

function encabezado() {
  doc.rect(X0, y, ANCHO, 46).fill(ROJO);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(16).text('SCITO ENTREPRISE - SOL CASH', X0 + 12, y + 8);
  doc.font('Helvetica').fontSize(10).text('Solicitud de número  /  Demann pou yon nimewo', X0 + 12, y + 28);
  y += 56;
  doc.fillColor(GRIS).font('Helvetica').fontSize(8.5).text(
    'Llene todos los campos con * . Puede llenarlo en el celular o en la computadora, o imprimirlo y llenarlo a mano. ' +
    'Ranpli tout kaz ki gen * . Ou ka ranpli l sou telefòn oswa sou òdinatè, oswa enprime l epi ekri ak plim.',
    X0, y, { width: ANCHO });
  y = doc.y + 8;
}

function seccion(es, ht) {
  espacio(40);
  doc.rect(X0, y, ANCHO, 18).fill('#F3F4F6');
  doc.fillColor(ROJO).font('Helvetica-Bold').fontSize(10.5).text(`${es}  /  ${ht}`, X0 + 6, y + 4);
  y += 24;
}

// Fila de campos: [{ es, ht, nombre, ancho (fracción), alto?, multi? }]
function fila(campos, alto = 18) {
  const hEt = 20;
  espacio(hEt + alto + 8);
  const gap = 8;
  const total = ANCHO - gap * (campos.length - 1);
  let x = X0;
  for (const c of campos) {
    const w = total * (c.ancho ?? 1 / campos.length);
    doc.fillColor('black').font('Helvetica-Bold').fontSize(8.5).text(c.es, x, y, { width: w, lineBreak: false });
    doc.fillColor(GRIS).font('Helvetica-Oblique').fontSize(7.5).text(c.ht, x, y + 10, { width: w, lineBreak: false });
    const h = c.alto ?? alto;
    doc.rect(x, y + hEt, w, h).lineWidth(0.6).strokeColor('#9CA3AF').stroke();
    doc.formText(c.nombre, x + 1, y + hEt + 1, w - 2, h - 2, { multiline: !!c.multi, fontSize: 10 });
    x += w + gap;
  }
  y += hEt + Math.max(...campos.map((c) => c.alto ?? alto)) + 8;
}

// Opciones con casillas: { es, ht, nombre, opciones: [[valor, etiqueta]] }
function opciones(o) {
  espacio(36);
  doc.fillColor('black').font('Helvetica-Bold').fontSize(8.5).text(o.es, X0, y);
  doc.fillColor(GRIS).font('Helvetica-Oblique').fontSize(7.5).text(o.ht, X0, y + 10);
  let x = X0;
  const yc = y + 22;
  for (const [valor, etiqueta] of o.opciones) {
    doc.rect(x, yc, 11, 11).lineWidth(0.6).strokeColor('#6B7280').stroke();
    doc.formCheckbox(`${o.nombre}_${valor}`, x, yc, 11, 11);
    doc.fillColor('black').font('Helvetica').fontSize(8.5).text(etiqueta, x + 15, yc + 1.5, { lineBreak: false });
    x += 15 + doc.widthOfString(etiqueta) + 18;
  }
  y = yc + 20;
}

function nota(texto) {
  espacio(30);
  doc.fillColor(GRIS).font('Helvetica').fontSize(7.8).text(texto, X0, y, { width: ANCHO });
  y = doc.y + 6;
}

encabezado();

seccion('1. El SAN', '1. SAN an');
fila([
  { es: 'SAN en que quiere participar *', ht: 'Nan ki SAN ou vle antre', nombre: 'san_nombre', ancho: 0.5 },
  { es: 'Número que desea', ht: 'Nimewo ou vle a', nombre: 'san_numero', ancho: 0.25 },
  { es: 'Turno o fecha preferida', ht: 'Tou oswa dat ou pito', nombre: 'san_turno', ancho: 0.25 },
]);
opciones({ es: 'Participa con *', ht: 'Ou patisipe ak', nombre: 'san_parte', opciones: [['completo', 'Número completo / Nimewo antye'], ['medio', 'Medio número / Mwatye nimewo']] });

seccion('2. Datos del participante', '2. Enfòmasyon moun ki patisipe a');
fila([
  { es: 'Nombre y apellido *', ht: 'Non ak siyati', nombre: 'p_nombre', ancho: 0.65 },
  { es: 'Código SCITO (si ya es cliente)', ht: 'Kòd SCITO (si w deja kliyan)', nombre: 'p_codigo', ancho: 0.35 },
]);
opciones({ es: 'Documento (opcional)', ht: 'Dokiman (si ou genyen)', nombre: 'p_doc_tipo', opciones: [['cedula', 'Cédula'], ['pasaporte', 'Pasaporte / Paspò'], ['cin', 'CIN / NIU (Haití)'], ['otro', 'Otro / Lòt']] });
fila([
  { es: 'Número del documento', ht: 'Nimewo dokiman an', nombre: 'p_doc_numero', ancho: 0.4 },
  { es: 'Fecha de nacimiento (opcional)', ht: 'Dat ou fèt (dd/mm/aaaa)', nombre: 'p_nacimiento', ancho: 0.3 },
  { es: 'Teléfono / WhatsApp *', ht: 'Telefòn / WhatsApp', nombre: 'p_telefono', ancho: 0.3 },
]);
fila([
  { es: 'Ocupación *', ht: 'Ki travay ou fè', nombre: 'p_ocupacion', ancho: 0.45 },
  { es: 'Lugar de trabajo', ht: 'Kote ou travay', nombre: 'p_trabajo', ancho: 0.55 },
]);
fila([
  { es: 'Sector *', ht: 'Katye', nombre: 'p_sector', ancho: 0.34 },
  { es: 'Municipio *', ht: 'Komin', nombre: 'p_municipio', ancho: 0.33 },
  { es: 'Provincia *', ht: 'Pwovens', nombre: 'p_provincia', ancho: 0.33 },
]);
fila([{ es: 'Referencia de la dirección * (ej.: al lado del colmado...)', ht: 'Endikasyon pou jwenn kay la (egz.: bò kote boutik la...)', nombre: 'p_referencia_dir', multi: true }], 30);
opciones({ es: 'Idioma del contrato *', ht: 'Nan ki lang ou vle kontra a', nombre: 'p_idioma', opciones: [['es', 'Español'], ['fr', 'Français'], ['ht', 'Kreyòl']] });

seccion('3. Contacto de emergencia', '3. Moun pou nou rele si gen ijans');
fila([
  { es: 'Nombre', ht: 'Non', nombre: 'e_nombre', ancho: 0.45 },
  { es: 'Teléfono', ht: 'Telefòn', nombre: 'e_telefono', ancho: 0.3 },
  { es: 'Relación', ht: 'Ki relasyon', nombre: 'e_relacion', ancho: 0.25 },
]);

seccion('4. Fiador (obligatorio)', '4. Garanti (obligatwa)');
nota('El fiador responde por las cuotas y la mora que el participante no pague. Su documento y su dirección son obligatorios. / ' +
  'Garanti a reponn pou kotizasyon ak penalite moun nan pa peye. Dokiman l ak adrès li obligatwa.');
fila([
  { es: 'Nombre y apellido *', ht: 'Non ak siyati', nombre: 'f_nombre', ancho: 0.45 },
  { es: 'Teléfono *', ht: 'Telefòn', nombre: 'f_telefono', ancho: 0.3 },
  { es: 'Relación *', ht: 'Ki relasyon', nombre: 'f_relacion', ancho: 0.25 },
]);
opciones({ es: 'Documento del fiador *', ht: 'Dokiman garanti a', nombre: 'f_doc_tipo', opciones: [['cedula', 'Cédula'], ['pasaporte', 'Pasaporte / Paspò'], ['cin', 'CIN / NIU (Haití)'], ['otro', 'Otro / Lòt']] });
fila([
  { es: 'Número del documento *', ht: 'Nimewo dokiman an', nombre: 'f_doc_numero', ancho: 0.4 },
  { es: 'Ocupación', ht: 'Ki travay li fè', nombre: 'f_ocupacion', ancho: 0.6 },
]);
fila([{ es: 'Dirección del fiador *', ht: 'Adrès garanti a', nombre: 'f_direccion', multi: true }], 30);

seccion('5. Referencias personales (al menos una)', '5. Moun ki konnen w (omwen youn)');
for (const i of [1, 2]) {
  fila([
    { es: `Referencia ${i}: nombre${i === 1 ? ' *' : ''}`, ht: `Referans ${i}: non`, nombre: `r${i}_nombre`, ancho: 0.45 },
    { es: `Teléfono${i === 1 ? ' *' : ''}`, ht: 'Telefòn', nombre: `r${i}_telefono`, ancho: 0.3 },
    { es: `Relación${i === 1 ? ' *' : ''}`, ht: 'Ki relasyon', nombre: `r${i}_relacion`, ancho: 0.25 },
  ]);
}

seccion('6. Declaración y firmas', '6. Deklarasyon ak siyati');
nota('Declaro que los datos son ciertos y autorizo a SCITO ENTREPRISE a usarlos solo para el SOL CASH y a llamar al fiador y a las referencias para confirmarlos. ' +
  'El número se asigna después de verificar el fiador y al menos una referencia, y de firmar el contrato. / ' +
  'Mwen deklare enfòmasyon sa yo vre e mwen otorize SCITO ENTREPRISE sèvi ak yo sèlman pou SOL CASH, epi rele garanti a ak referans yo pou konfime. ' +
  'Yo bay nimewo a apre yo fin verifye garanti a ak omwen yon referans, epi apre ou siyen kontra a.');
fila([
  { es: 'Firma del participante', ht: 'Siyati moun ki patisipe a', nombre: 'firma_participante', ancho: 0.38 },
  { es: 'Firma del fiador', ht: 'Siyati garanti a', nombre: 'firma_fiador', ancho: 0.38 },
  { es: 'Fecha', ht: 'Dat', nombre: 'fecha', ancho: 0.24 },
], 28);

seccion('Solo para la oficina', 'Pou biwo a sèlman');
fila([
  { es: 'Recibido por', ht: '', nombre: 'of_recibido', ancho: 0.3 },
  { es: 'Fecha', ht: '', nombre: 'of_fecha', ancho: 0.2 },
  { es: 'Número asignado', ht: '', nombre: 'of_numero', ancho: 0.2 },
  { es: 'Contrato firmado (fecha)', ht: '', nombre: 'of_contrato', ancho: 0.3 },
]);
opciones({ es: 'Verificado', ht: '', nombre: 'of_verificado', opciones: [['fiador', 'Fiador confirmado'], ['referencia', 'Referencia confirmada'], ['ficha', 'Ficha registrada en ANSCITO']] });
nota('Los datos personales se protegen según la Ley 172-13; el texto de este formulario y del contrato debe revisarlo el abogado de la empresa.');

doc.end();
console.log('PDF creado:', salida);
