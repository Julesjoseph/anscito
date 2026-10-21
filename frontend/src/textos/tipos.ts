// Formato del diccionario del traductor de pantalla (src/traductor.ts).
// Frase: [español, inglés, francés, kreyòl]. El español debe ser igual al
// texto que se ve (los espacios de más no importan).
export type Frase = [string, string, string, string]

// Textos con partes que cambian (nombres, montos, números): una expresión
// regular sobre el español y, en cada idioma, cómo armarlo con las partes.
export type Patron = {
  es: RegExp
  en: (...p: string[]) => string
  fr: (...p: string[]) => string
  ht: (...p: string[]) => string
}
