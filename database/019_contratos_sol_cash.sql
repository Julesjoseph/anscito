-- ANSCITO 019: el SAN se llama ahora SOL CASH en pantalla, recibos y contratos.
-- Crea una versión nueva de cada plantilla de contrato con "SOL CASH" en
-- lugar de la palabra "SAN" (las versiones anteriores se conservan; los
-- contratos ya generados no cambian). Los marcadores {{san_…}} siguen igual.
BEGIN;

INSERT INTO san_contrato_plantillas (idioma, version, titulo, texto)
SELECT idioma,
       version + 1,
       regexp_replace(titulo, '\mSAN\M', 'SOL CASH', 'g'),
       regexp_replace(texto, '\mSAN\M', 'SOL CASH', 'g')
FROM (SELECT DISTINCT ON (idioma) idioma, version, titulo, texto
      FROM san_contrato_plantillas ORDER BY idioma, version DESC) ultima
WHERE titulo ~ '\mSAN\M' OR texto ~ '\mSAN\M';

COMMIT;
