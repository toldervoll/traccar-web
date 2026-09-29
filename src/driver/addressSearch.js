// Address search in the open address service of Kartverket (plan KTD18). Pure module.
export const ADDRESS_MUNICIPALITY = '0301';
export const ADDRESS_MAX_MATCHES = 10;

// The service matches whole words: `*` on each word of two or more characters with no
// digit. A number gets none, because `10*` lists 100-102E before 10A.
export const searchText = (text) =>
  text
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length >= 2 && !/\d/.test(word) ? `${word}*` : word))
    .join(' ');

export const searchUrl = (text) =>
  `https://ws.geonorge.no/adresser/v1/sok?${new URLSearchParams({
    sok: searchText(text),
    kommunenummer: ADDRESS_MUNICIPALITY,
    treffPerSide: ADDRESS_MAX_MATCHES,
  })}`;

export const parseMatches = (json) =>
  (Array.isArray(json?.adresser) ? json.adresser : [])
    .map((a) => {
      const { lat, lon } = a?.representasjonspunkt || {};
      if (typeof a?.adressetekst !== 'string' || typeof lat !== 'number' || typeof lon !== 'number')
        return null;
      return { label: `${a.adressetekst}, ${a.postnummer} ${a.poststed}`, lat, lon };
    })
    .filter(Boolean);
