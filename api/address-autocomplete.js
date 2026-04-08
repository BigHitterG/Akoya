function mapUsStateNameToCode(name) {
  const normalized = (name || '').trim().toLowerCase();
  const map = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
    colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
    hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
    kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
    massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
    montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
    oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
    virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
    'district of columbia': 'DC'
  };
  return map[normalized] || '';
}

function mapCanadaProvinceNameToCode(name) {
  const normalized = (name || '').trim().toLowerCase();
  const map = {
    alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
    'newfoundland and labrador': 'NL', 'nova scotia': 'NS', 'northwest territories': 'NT',
    nunavut: 'NU', ontario: 'ON', 'prince edward island': 'PE', quebec: 'QC',
    saskatchewan: 'SK', yukon: 'YT'
  };
  return map[normalized] || '';
}

function parseSuggestion(item, countryCode) {
  const address = item?.address || {};
  const houseNumber = address.house_number || '';
  const road = address.road || address.pedestrian || address.cycleway || '';
  const street1 = [houseNumber, road].filter(Boolean).join(' ').trim() || item?.name || '';
  const city = address.city || address.town || address.village || address.hamlet || '';
  const stateName = address.state || address.province || '';
  const stateOrProvinceCode = countryCode === 'CA' ? mapCanadaProvinceNameToCode(stateName) : mapUsStateNameToCode(stateName);
  const postalCode = address.postcode || '';
  const labelParts = [street1, city, stateOrProvinceCode || stateName, postalCode, countryCode].filter(Boolean);

  if (!street1 || !city) {
    return null;
  }

  return {
    label: labelParts.join(', '),
    street1,
    city,
    stateOrProvinceCode,
    postalCode,
    countryCode
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const query = (req.query?.query || '').trim();
  const countryCode = ((req.query?.countryCode || 'US').trim().toUpperCase() === 'CA') ? 'CA' : 'US';

  if (query.length < 4) {
    res.status(200).json({ suggestions: [] });
    return;
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', countryCode.toLowerCase());
  url.searchParams.set('limit', '5');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'AkoyaInvoiceAddressAutocomplete/1.0'
      }
    });

    if (!response.ok) {
      const details = await response.text();
      res.status(502).json({
        error: 'Address autocomplete failed.',
        details: details.slice(0, 200)
      });
      return;
    }

    const items = await response.json();
    const suggestions = (Array.isArray(items) ? items : [])
      .map((item) => parseSuggestion(item, countryCode))
      .filter(Boolean);

    res.status(200).json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: 'Address autocomplete unavailable.' });
  }
};
