const US_STATE_NAME_TO_CODE = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC'
};

const CA_PROVINCE_NAME_TO_CODE = {
  alberta: 'AB',
  'british columbia': 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  'nova scotia': 'NS',
  'northwest territories': 'NT',
  nunavut: 'NU',
  ontario: 'ON',
  'prince edward island': 'PE',
  quebec: 'QC',
  saskatchewan: 'SK',
  yukon: 'YT'
};

function normalizeStateOrProvinceCode(value, countryCode) {
  if (typeof value !== 'string') {
    return '';
  }

  const rawValue = value.trim();
  if (!rawValue) {
    return '';
  }

  const upperValue = rawValue.toUpperCase();
  if (/^[A-Z]{2}$/.test(upperValue)) {
    return upperValue;
  }

  const normalizedCountryCode = String(countryCode || 'US').trim().toUpperCase();
  const normalizedName = rawValue.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalizedCountryCode === 'CA') {
    return CA_PROVINCE_NAME_TO_CODE[normalizedName] || '';
  }

  return US_STATE_NAME_TO_CODE[normalizedName] || '';
}

module.exports = {
  normalizeStateOrProvinceCode
};
