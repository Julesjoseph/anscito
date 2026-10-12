-- ANSCITO 018: ficha completa de los participantes del SAN, referencias y
-- fiador (con confirmación), fotos del documento, y contratos en español,
-- francés y criollo haitiano (plantillas editables con versiones).
-- El texto del contrato es un BORRADOR: debe revisarlo un abogado.
BEGIN;

-- Documento de identidad de Haití (además de cédula, pasaporte y otro).
INSERT INTO tipos_documento (codigo, nombre, patron, ayuda, orden) VALUES
  ('cin_haiti', 'CIN / NIU (Haití)', '^[A-Z0-9]{8,20}$', 'CIN o NIU de Haití: 8 a 20 letras o números', 5);

-- Datos del participante que pide el SAN (uno por cliente).
CREATE TABLE san_fichas (
  tercero_id            uuid PRIMARY KEY REFERENCES terceros(id),
  fecha_nacimiento      date          NOT NULL,
  ocupacion             varchar(100)  NOT NULL,
  lugar_trabajo         varchar(150),
  sector                varchar(100)  NOT NULL,
  municipio             varchar(100)  NOT NULL,
  provincia             varchar(100)  NOT NULL,
  referencia_direccion  varchar(200)  NOT NULL,   -- "al lado del colmado…"
  emergencia_nombre     varchar(150),
  emergencia_telefono   varchar(30),
  emergencia_relacion   varchar(60),
  idioma                varchar(2)    NOT NULL DEFAULT 'es',  -- idioma preferido del contrato
  created_by            uuid          NOT NULL REFERENCES usuarios(id),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES usuarios(id),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT san_fichas_idioma CHECK (idioma IN ('es', 'fr', 'ht')),
  CONSTRAINT san_fichas_nacimiento CHECK (fecha_nacimiento > DATE '1900-01-01'),
  CONSTRAINT san_fichas_emergencia CHECK (
    (emergencia_nombre IS NULL) = (emergencia_telefono IS NULL))
);

-- Referencias personales y fiador. No se borran: se desactivan.
CREATE TABLE san_garantes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tercero_id          uuid          NOT NULL REFERENCES terceros(id),
  tipo                varchar(12)   NOT NULL,          -- referencia | fiador
  nombre              varchar(150)  NOT NULL,
  telefono            varchar(30)   NOT NULL,
  relacion            varchar(60)   NOT NULL,          -- "hermano", "vecina", "jefe"…
  tipo_documento_id   uuid REFERENCES tipos_documento(id),
  numero_documento    varchar(30),
  direccion           varchar(250),
  ocupacion           varchar(100),
  -- Confirmación (alguien de la oficina llamó y verificó).
  confirmado          boolean       NOT NULL DEFAULT false,
  confirmado_por      uuid REFERENCES usuarios(id),
  confirmado_en       timestamptz,
  nota_confirmacion   varchar(300),
  is_active           boolean       NOT NULL DEFAULT true,
  created_by          uuid          NOT NULL REFERENCES usuarios(id),
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT san_garantes_tipo CHECK (tipo IN ('referencia', 'fiador')),
  -- El fiador responde por la deuda: documento y dirección obligatorios.
  CONSTRAINT san_garantes_fiador CHECK (tipo <> 'fiador' OR (
    tipo_documento_id IS NOT NULL AND numero_documento IS NOT NULL AND direccion IS NOT NULL)),
  CONSTRAINT san_garantes_confirmado CHECK (confirmado = (confirmado_por IS NOT NULL AND confirmado_en IS NOT NULL))
);
CREATE INDEX san_garantes_tercero_idx ON san_garantes (tercero_id) WHERE is_active;
-- Un solo fiador activo por persona.
CREATE UNIQUE INDEX san_garantes_un_fiador ON san_garantes (tercero_id) WHERE tipo = 'fiador' AND is_active;

-- Archivos: fotos del documento y contratos firmados (imágenes o PDF pequeños).
CREATE TABLE san_archivos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tercero_id    uuid          NOT NULL REFERENCES terceros(id),
  tipo          varchar(20)   NOT NULL,      -- documento_frente | documento_dorso | contrato_firmado
  contrato_id   uuid,                        -- para contrato_firmado (FK abajo)
  mime          varchar(30)   NOT NULL,
  datos         bytea         NOT NULL,
  is_active     boolean       NOT NULL DEFAULT true,
  subido_por    uuid          NOT NULL REFERENCES usuarios(id),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT san_archivos_tipo CHECK (tipo IN ('documento_frente', 'documento_dorso', 'contrato_firmado')),
  CONSTRAINT san_archivos_mime CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  CONSTRAINT san_archivos_tamano CHECK (octet_length(datos) <= 768000),
  CONSTRAINT san_archivos_contrato CHECK ((tipo = 'contrato_firmado') = (contrato_id IS NOT NULL))
);
CREATE INDEX san_archivos_tercero_idx ON san_archivos (tercero_id, tipo) WHERE is_active;

-- Plantillas del contrato por idioma. Cambiar el texto crea una versión nueva.
CREATE TABLE san_contrato_plantillas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idioma      varchar(2)    NOT NULL,
  version     int           NOT NULL,
  titulo      varchar(150)  NOT NULL,
  texto       text          NOT NULL,       -- con marcadores {{participante}}, {{cuota}}…
  created_by  uuid REFERENCES usuarios(id),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT san_plantillas_idioma CHECK (idioma IN ('es', 'fr', 'ht')),
  CONSTRAINT san_plantillas_unica UNIQUE (idioma, version)
);

-- Contratos generados: el texto queda congelado tal como se imprimió.
CREATE TABLE san_contratos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero            bigint        NOT NULL UNIQUE,
  participacion_id  uuid          NOT NULL REFERENCES san_participaciones(id),
  plantilla_id      uuid          NOT NULL REFERENCES san_contrato_plantillas(id),
  idioma            varchar(2)    NOT NULL,
  titulo            varchar(150)  NOT NULL,
  texto             text          NOT NULL,
  estado            varchar(10)   NOT NULL DEFAULT 'generado',   -- generado | firmado | anulado
  firmado_en        timestamptz,
  firmado_registrado_por uuid REFERENCES usuarios(id),
  motivo_anulacion  varchar(300),
  created_by        uuid          NOT NULL REFERENCES usuarios(id),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT san_contratos_estado CHECK (estado IN ('generado', 'firmado', 'anulado')),
  CONSTRAINT san_contratos_firmado CHECK ((estado = 'firmado') = (firmado_en IS NOT NULL AND firmado_registrado_por IS NOT NULL)
    OR estado = 'anulado'),
  CONSTRAINT san_contratos_anulado CHECK ((estado = 'anulado') = (motivo_anulacion IS NOT NULL))
);
-- Un solo contrato vigente (no anulado) por número del SAN.
CREATE UNIQUE INDEX san_contratos_vigente ON san_contratos (participacion_id) WHERE estado <> 'anulado';
ALTER TABLE san_archivos ADD CONSTRAINT san_archivos_contrato_fk
  FOREIGN KEY (contrato_id) REFERENCES san_contratos(id);
INSERT INTO contadores (clave, valor) VALUES ('san_contratos', 0);

-- El texto de un contrato generado no se cambia ni se borra.
CREATE FUNCTION san_contrato_proteger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los contratos no se borran: se anulan';
  END IF;
  IF NEW.texto <> OLD.texto OR NEW.titulo <> OLD.titulo OR NEW.participacion_id <> OLD.participacion_id
     OR NEW.plantilla_id <> OLD.plantilla_id OR NEW.numero <> OLD.numero THEN
    RAISE EXCEPTION 'El texto de un contrato generado no se cambia';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER san_contratos_proteger BEFORE UPDATE OR DELETE ON san_contratos
  FOR EACH ROW EXECUTE FUNCTION san_contrato_proteger();

CREATE FUNCTION san_plantilla_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las plantillas no se cambian: se crea una versión nueva';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER san_plantillas_inmutables BEFORE UPDATE OR DELETE ON san_contrato_plantillas
  FOR EACH ROW EXECUTE FUNCTION san_plantilla_inmutable();

INSERT INTO permisos (codigo, modulo, accion, descripcion) VALUES
  ('sanes.fichas',     'sanes', 'fichas',     'Registrar y editar la ficha de los participantes (con fotos del documento)'),
  ('sanes.verificar',  'sanes', 'verificar',  'Confirmar las referencias y el fiador'),
  ('sanes.contratos',  'sanes', 'contratos',  'Generar contratos y registrar el contrato firmado'),
  ('sanes.plantillas', 'sanes', 'plantillas', 'Cambiar el texto de los contratos');

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.codigo IN ('sanes.fichas', 'sanes.verificar', 'sanes.contratos', 'sanes.plantillas')
WHERE r.codigo = 'administrador';

-- Plantillas iniciales (BORRADOR). Los marcadores {{…}} se reemplazan al generar.
INSERT INTO san_contrato_plantillas (idioma, version, titulo, texto) VALUES
('es', 1, 'CONTRATO DE PARTICIPACIÓN EN SAN',
'BORRADOR — Este texto debe ser revisado por un abogado antes de usarse.

Entre {{empresa}}, RNC {{empresa_rnc}}, con domicilio en {{empresa_direccion}}, en lo adelante "LA ADMINISTRADORA", y {{participante}}, portador(a) del documento {{documento_tipo}} No. {{documento}}, domiciliado(a) en {{direccion}}, en lo adelante "EL PARTICIPANTE", se conviene lo siguiente:

PRIMERO — OBJETO. EL PARTICIPANTE se integra al SAN {{san_codigo}} "{{san_nombre}}", administrado por LA ADMINISTRADORA, con el número {{numero}} ({{parte}}).

SEGUNDO — CUOTAS. EL PARTICIPANTE pagará una cuota de {{cuota}} con frecuencia {{frecuencia}}, durante {{cantidad_turnos}} turnos, a partir del {{fecha_inicio}}. Las cuotas se pagan en la oficina de LA ADMINISTRADORA, en efectivo o por transferencia, y se entrega recibo de cada pago.

TERCERO — ENTREGA DE LA MANO. A EL PARTICIPANTE le corresponde recibir la mano de {{mano}} el día {{fecha_mano}}. De la mano se descuenta la comisión de administración de {{comision_pct}} ({{comision}}), así como las cuotas vencidas que EL PARTICIPANTE deba en ese momento, con su mora.

CUARTO — ATRASOS Y MORA. Si una cuota no se paga dentro de los {{dias_gracia}} días siguientes a su fecha, se cobrará una mora de {{mora_pct}} de la cuota.

QUINTO — FIADOR. {{fiador}}, portador(a) del documento {{fiador_documento}}, domiciliado(a) en {{fiador_direccion}}, se constituye en fiador(a) solidario(a) de EL PARTICIPANTE y responde por las cuotas y la mora que EL PARTICIPANTE deje de pagar.

SEXTO — DATOS. EL PARTICIPANTE declara que los datos suministrados son correctos y autoriza a LA ADMINISTRADORA a guardarlos para administrar el SAN.

Hecho en {{ciudad}}, el {{fecha}}, en dos originales.

{{firmas}}'),
('fr', 1, 'CONTRAT DE PARTICIPATION AU SAN',
'BROUILLON — Ce texte doit être révisé par un avocat avant d''être utilisé.

Entre {{empresa}}, RNC {{empresa_rnc}}, domiciliée à {{empresa_direccion}}, ci-après « L''ADMINISTRATEUR », et {{participante}}, porteur(se) du document {{documento_tipo}} No. {{documento}}, domicilié(e) à {{direccion}}, ci-après « LE PARTICIPANT », il est convenu ce qui suit :

ARTICLE 1 — OBJET. LE PARTICIPANT intègre le SAN {{san_codigo}} « {{san_nombre}} », administré par L''ADMINISTRATEUR, avec le numéro {{numero}} ({{parte}}).

ARTICLE 2 — COTISATIONS. LE PARTICIPANT paiera une cotisation de {{cuota}} avec une fréquence {{frecuencia}}, pendant {{cantidad_turnos}} tours, à partir du {{fecha_inicio}}. Les cotisations se paient au bureau de L''ADMINISTRATEUR, en espèces ou par virement, et un reçu est remis pour chaque paiement.

ARTICLE 3 — REMISE DE LA MAIN. LE PARTICIPANT recevra la main de {{mano}} le {{fecha_mano}}. Seront déduites de la main la commission d''administration de {{comision_pct}} ({{comision}}) ainsi que les cotisations échues que LE PARTICIPANT doit à ce moment, avec leurs pénalités.

ARTICLE 4 — RETARDS ET PÉNALITÉS. Si une cotisation n''est pas payée dans les {{dias_gracia}} jours suivant sa date, une pénalité de {{mora_pct}} de la cotisation sera appliquée.

ARTICLE 5 — GARANT. {{fiador}}, porteur(se) du document {{fiador_documento}}, domicilié(e) à {{fiador_direccion}}, se porte garant(e) solidaire du PARTICIPANT et répond des cotisations et pénalités que LE PARTICIPANT ne paierait pas.

ARTICLE 6 — DONNÉES. LE PARTICIPANT déclare que les données fournies sont exactes et autorise L''ADMINISTRATEUR à les conserver pour la gestion du SAN.

Fait à {{ciudad}}, le {{fecha}}, en deux exemplaires originaux.

{{firmas}}'),
('ht', 1, 'KONTRA PATISIPASYON NAN SAN',
'BOUYON — Yon avoka dwe revize tèks sa a anvan yo sèvi avè l.

Ant {{empresa}}, RNC {{empresa_rnc}}, ki chita nan {{empresa_direccion}}, ke n ap rele « ADMINISTRATÈ A », ak {{participante}}, ki gen dokiman {{documento_tipo}} No. {{documento}}, ki rete nan {{direccion}}, ke n ap rele « PATISIPAN AN », nou dakò sou sa ki annapre yo:

1 — OBJÈ. PATISIPAN AN antre nan SAN {{san_codigo}} « {{san_nombre}} », ke ADMINISTRATÈ A ap jere, ak nimewo {{numero}} ({{parte}}).

2 — KOTIZASYON. PATISIPAN AN ap peye yon kotizasyon {{cuota}} chak {{frecuencia}}, pandan {{cantidad_turnos}} tou, apati {{fecha_inicio}}. Kotizasyon yo peye nan biwo ADMINISTRATÈ A, kach oswa pa transfè, epi yo bay yon resi pou chak peman.

3 — LAMEN. PATISIPAN AN ap resevwa lamen {{mano}} nan dat {{fecha_mano}}. Y ap retire nan lamen an komisyon administrasyon {{comision_pct}} ({{comision}}), ansanm ak kotizasyon PATISIPAN AN dwe nan moman sa a, ak penalite yo.

4 — RETA AK PENALITE. Si yon kotizasyon pa peye nan {{dias_gracia}} jou apre dat li, y ap mete yon penalite {{mora_pct}} sou kotizasyon an.

5 — GARANTI. {{fiador}}, ki gen dokiman {{fiador_documento}}, ki rete nan {{fiador_direccion}}, se garanti solidè PATISIPAN AN epi l ap reponn pou kotizasyon ak penalite PATISIPAN AN pa peye.

6 — ENFÒMASYON. PATISIPAN AN di enfòmasyon li bay yo kòrèk epi li otorize ADMINISTRATÈ A kenbe yo pou jere SAN an.

Fèt nan {{ciudad}}, {{fecha}}, an de orijinal.

{{firmas}}');

COMMIT;
