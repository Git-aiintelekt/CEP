"""A phone number's country, and the sender type of a text sender, for what texts cost (apps/delivery/costs.py).

country_of('+14045550100') -> 'US': the longest dialling code that matches, with the North American area codes that are not the
United States (Canada, the Caribbean). Numbers are E.164 in sms_execution (ck_sms_phone_e164); one that matches nothing is None.

WhatsApp is priced by Meta's markets: some single countries, North America, and regional groups ("Rest of Latin America"); a
country in none of them falls in Other. meta_market_candidates() lists the names a card may use for a country, most specific first.
"""
import re

# ISO 3166 alpha-2 -> (name, dialling code). The dialling codes of the countries a workspace may text.
COUNTRIES = {
    "US": ("United States", "1"), "CA": ("Canada", "1"), "BS": ("Bahamas", "1242"), "BB": ("Barbados", "1246"), "AI": ("Anguilla", "1264"),
    "AG": ("Antigua and Barbuda", "1268"), "VG": ("British Virgin Islands", "1284"), "VI": ("US Virgin Islands", "1340"), "KY": ("Cayman Islands", "1345"),
    "BM": ("Bermuda", "1441"), "GD": ("Grenada", "1473"), "TC": ("Turks and Caicos Islands", "1649"), "JM": ("Jamaica", "1876"), "MS": ("Montserrat", "1664"),
    "MP": ("Northern Mariana Islands", "1670"), "GU": ("Guam", "1671"), "AS": ("American Samoa", "1684"), "SX": ("Sint Maarten", "1721"), "LC": ("Saint Lucia", "1758"),
    "DM": ("Dominica", "1767"), "VC": ("Saint Vincent and the Grenadines", "1784"), "PR": ("Puerto Rico", "1787"), "DO": ("Dominican Republic", "1809"),
    "TT": ("Trinidad and Tobago", "1868"), "KN": ("Saint Kitts and Nevis", "1869"),
    "RU": ("Russia", "7"), "KZ": ("Kazakhstan", "77"), "EG": ("Egypt", "20"), "ZA": ("South Africa", "27"), "GR": ("Greece", "30"), "NL": ("Netherlands", "31"),
    "BE": ("Belgium", "32"), "FR": ("France", "33"), "ES": ("Spain", "34"), "HU": ("Hungary", "36"), "IT": ("Italy", "39"), "RO": ("Romania", "40"),
    "CH": ("Switzerland", "41"), "AT": ("Austria", "43"), "GB": ("United Kingdom", "44"), "DK": ("Denmark", "45"), "SE": ("Sweden", "46"), "NO": ("Norway", "47"),
    "PL": ("Poland", "48"), "DE": ("Germany", "49"), "PE": ("Peru", "51"), "MX": ("Mexico", "52"), "CU": ("Cuba", "53"), "AR": ("Argentina", "54"),
    "BR": ("Brazil", "55"), "CL": ("Chile", "56"), "CO": ("Colombia", "57"), "VE": ("Venezuela", "58"), "MY": ("Malaysia", "60"), "AU": ("Australia", "61"),
    "ID": ("Indonesia", "62"), "PH": ("Philippines", "63"), "NZ": ("New Zealand", "64"), "SG": ("Singapore", "65"), "TH": ("Thailand", "66"), "JP": ("Japan", "81"),
    "KR": ("South Korea", "82"), "VN": ("Vietnam", "84"), "CN": ("China", "86"), "TR": ("Turkey", "90"), "IN": ("India", "91"), "PK": ("Pakistan", "92"),
    "AF": ("Afghanistan", "93"), "LK": ("Sri Lanka", "94"), "MM": ("Myanmar", "95"), "IR": ("Iran", "98"), "SS": ("South Sudan", "211"), "MA": ("Morocco", "212"),
    "DZ": ("Algeria", "213"), "TN": ("Tunisia", "216"), "LY": ("Libya", "218"), "GM": ("Gambia", "220"), "SN": ("Senegal", "221"), "MR": ("Mauritania", "222"),
    "ML": ("Mali", "223"), "GN": ("Guinea", "224"), "CI": ("Ivory Coast", "225"), "BF": ("Burkina Faso", "226"), "NE": ("Niger", "227"), "TG": ("Togo", "228"),
    "BJ": ("Benin", "229"), "MU": ("Mauritius", "230"), "LR": ("Liberia", "231"), "SL": ("Sierra Leone", "232"), "GH": ("Ghana", "233"), "NG": ("Nigeria", "234"),
    "TD": ("Chad", "235"), "CF": ("Central African Republic", "236"), "CM": ("Cameroon", "237"), "CV": ("Cape Verde", "238"), "GQ": ("Equatorial Guinea", "240"),
    "GA": ("Gabon", "241"), "CG": ("Congo", "242"), "CD": ("DR Congo", "243"), "AO": ("Angola", "244"), "GW": ("Guinea-Bissau", "245"), "SC": ("Seychelles", "248"),
    "SD": ("Sudan", "249"), "RW": ("Rwanda", "250"), "ET": ("Ethiopia", "251"), "SO": ("Somalia", "252"), "DJ": ("Djibouti", "253"), "KE": ("Kenya", "254"),
    "TZ": ("Tanzania", "255"), "UG": ("Uganda", "256"), "BI": ("Burundi", "257"), "MZ": ("Mozambique", "258"), "ZM": ("Zambia", "260"), "MG": ("Madagascar", "261"),
    "ZW": ("Zimbabwe", "263"), "NA": ("Namibia", "264"), "MW": ("Malawi", "265"), "LS": ("Lesotho", "266"), "BW": ("Botswana", "267"), "SZ": ("Eswatini", "268"),
    "KM": ("Comoros", "269"), "ER": ("Eritrea", "291"), "AW": ("Aruba", "297"), "GI": ("Gibraltar", "350"), "PT": ("Portugal", "351"), "LU": ("Luxembourg", "352"),
    "IE": ("Ireland", "353"), "IS": ("Iceland", "354"), "AL": ("Albania", "355"), "MT": ("Malta", "356"), "CY": ("Cyprus", "357"), "FI": ("Finland", "358"),
    "BG": ("Bulgaria", "359"), "LT": ("Lithuania", "370"), "LV": ("Latvia", "371"), "EE": ("Estonia", "372"), "MD": ("Moldova", "373"), "AM": ("Armenia", "374"),
    "BY": ("Belarus", "375"), "AD": ("Andorra", "376"), "MC": ("Monaco", "377"), "UA": ("Ukraine", "380"), "RS": ("Serbia", "381"), "ME": ("Montenegro", "382"),
    "XK": ("Kosovo", "383"), "HR": ("Croatia", "385"), "SI": ("Slovenia", "386"), "BA": ("Bosnia and Herzegovina", "387"), "MK": ("North Macedonia", "389"),
    "CZ": ("Czech Republic", "420"), "SK": ("Slovakia", "421"), "LI": ("Liechtenstein", "423"), "BZ": ("Belize", "501"), "GT": ("Guatemala", "502"),
    "SV": ("El Salvador", "503"), "HN": ("Honduras", "504"), "NI": ("Nicaragua", "505"), "CR": ("Costa Rica", "506"), "PA": ("Panama", "507"), "HT": ("Haiti", "509"),
    "BO": ("Bolivia", "591"), "GY": ("Guyana", "592"), "EC": ("Ecuador", "593"), "PY": ("Paraguay", "595"), "SR": ("Suriname", "597"), "UY": ("Uruguay", "598"),
    "CW": ("Curaçao", "599"), "BN": ("Brunei", "673"), "PG": ("Papua New Guinea", "675"), "FJ": ("Fiji", "679"), "HK": ("Hong Kong", "852"), "MO": ("Macau", "853"),
    "KH": ("Cambodia", "855"), "LA": ("Laos", "856"), "BD": ("Bangladesh", "880"), "TW": ("Taiwan", "886"), "MV": ("Maldives", "960"), "LB": ("Lebanon", "961"),
    "JO": ("Jordan", "962"), "SY": ("Syria", "963"), "IQ": ("Iraq", "964"), "KW": ("Kuwait", "965"), "SA": ("Saudi Arabia", "966"), "YE": ("Yemen", "967"),
    "OM": ("Oman", "968"), "PS": ("Palestine", "970"), "AE": ("United Arab Emirates", "971"), "IL": ("Israel", "972"), "BH": ("Bahrain", "973"), "QA": ("Qatar", "974"),
    "BT": ("Bhutan", "975"), "MN": ("Mongolia", "976"), "NP": ("Nepal", "977"), "TJ": ("Tajikistan", "992"), "TM": ("Turkmenistan", "993"), "AZ": ("Azerbaijan", "994"),
    "GE": ("Georgia", "995"), "KG": ("Kyrgyzstan", "996"), "UZ": ("Uzbekistan", "998"),
}
# North American area codes that are not the United States (the rest of +1 is)
CANADA_AREAS = ("204 226 236 249 250 257 263 273 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 450 460 468 474 506 514 519 548 579 581 584 "
                "587 600 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942").split()
NANP_OTHER = {"242": "BS", "246": "BB", "264": "AI", "268": "AG", "284": "VG", "340": "VI", "345": "KY", "441": "BM", "473": "GD", "649": "TC", "658": "JM",
              "876": "JM", "664": "MS", "670": "MP", "671": "GU", "684": "AS", "721": "SX", "758": "LC", "767": "DM", "784": "VC", "787": "PR", "939": "PR",
              "809": "DO", "829": "DO", "849": "DO", "868": "TT", "869": "KN"}
_BY_CODE = {}
for _iso, (_name, _code) in COUNTRIES.items():
    if not _code.startswith("1"):
        _BY_CODE.setdefault(_code, _iso)
_LONGEST = max(len(code) for code in _BY_CODE)


def country_of(phone: str | None) -> str | None:
    """The ISO country of an E.164 number, or None."""
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        return None
    if digits.startswith("1"):
        area = digits[1:4]
        if area in NANP_OTHER:
            return NANP_OTHER[area]
        return "CA" if area in CANADA_AREAS else "US"
    for size in range(_LONGEST, 0, -1):
        if digits[:size] in _BY_CODE:
            return _BY_CODE[digits[:size]]
    return None


def name_of(iso: str | None) -> str:
    return COUNTRIES.get((iso or "").upper(), (iso or "Unknown", ""))[0]


def choices() -> list[tuple[str, str]]:
    """(ISO, name) by name: the countries a rate can be limited to."""
    return sorted(((iso, name) for iso, (name, _) in COUNTRIES.items()), key=lambda pair: pair[1])


def sender_type(sender_id: str | None) -> str:
    """What kind of number a text goes out from: letters = ALPHANUMERIC, 3 to 8 digits = SHORT_CODE, a North American 8XX number =
    TOLL_FREE, any other full number = LONG_CODE."""
    value = (sender_id or "").strip()
    if not value:
        return "ANY"
    if re.search(r"[A-Za-z]", value):
        return "ALPHANUMERIC"
    digits = re.sub(r"\D", "", value)
    if 3 <= len(digits) <= 8:
        return "SHORT_CODE"
    if len(digits) == 11 and digits.startswith("1") and digits[1:4] in ("800", "833", "844", "855", "866", "877", "888"):
        return "TOLL_FREE"
    if len(digits) == 10 and digits[:3] in ("800", "833", "844", "855", "866", "877", "888"):
        return "TOLL_FREE"
    return "LONG_CODE"


SENDER_TYPES = [("ANY", "Any"), ("SHORT_CODE", "Short Code"), ("LONG_CODE", "Long Code (10DLC)"), ("TOLL_FREE", "Toll-Free"), ("ALPHANUMERIC", "Alphanumeric")]
SENDER_TYPE_LABELS = dict(SENDER_TYPES)

# ---- Meta's WhatsApp markets: the regional groups (from Meta's pricing page); a country in no group and with no market of its own is Other
META_GROUPS = {
    "North America": "US CA",
    "Rest of Africa": "DZ AO BJ BW BF BI CM TD CG CD ER ET GA GM GH GW CI KE LS LR LY MG MW ML MR MA MZ NA NE RW SN SL SO SS SD SZ TZ TG TN UG ZM",
    "Rest of Asia Pacific": "AF AU BD KH CN HK JP LA MN NP NZ PG PH SG LK TW TJ TM UZ VN",
    "Rest of Central & Eastern Europe": "AL AM AZ BY BG HR CZ GE GR HU LV LT MK MD PL RO RS SK SI UA",
    "Rest of Latin America": "BO CR DO EC SV GT HT HN JM NI PA PY PR UY VE",
    "Rest of Middle East": "BH IQ JO KW LB OM QA YE",
    "Rest of Western Europe": "AT BE DK FI IE NO PT SE CH",
}
_GROUP_OF = {iso: group for group, members in META_GROUPS.items() for iso in members.split()}
OTHER = "Other"
# what Meta's card may call a single-country market
_ALIASES = {"UK": "GB", "UNITED STATES OF AMERICA": "US", "USA": "US", "UAE": "AE", "RUSSIAN FEDERATION": "RU", "TURKIYE": "TR", "TÜRKIYE": "TR"}
_NAME_TO_ISO = {name.upper(): iso for iso, (name, _) in COUNTRIES.items()}


def market_iso(market: str) -> str | None:
    """The country a single-country market names, or None for a group or Other."""
    key = (market or "").strip().upper()
    return _ALIASES.get(key) or _NAME_TO_ISO.get(key)


def meta_market_candidates(iso: str | None) -> list[str]:
    """The market names that may price a country, most specific first: its own name, its group, Other."""
    out = []
    if iso:
        out.append(name_of(iso))
        if iso in _GROUP_OF:
            out.append(_GROUP_OF[iso])
    out.append(OTHER)
    return out


def market_for(iso: str | None, markets: list[str]) -> str | None:
    """Which of a card's markets prices a country (case-insensitive), or None when the card has none for it."""
    by_key = {}
    for market in markets:
        by_key[market.strip().lower()] = market
        code = market_iso(market)
        if code:
            by_key[name_of(code).lower()] = market
    for candidate in meta_market_candidates(iso):
        if candidate.lower() in by_key:
            return by_key[candidate.lower()]
    return None


def market_members(market: str) -> list[str]:
    """The ISO countries in a market: its country, its group's members, or [] for Other."""
    code = market_iso(market)
    if code:
        return [code]
    for group, members in META_GROUPS.items():
        if group.lower() == (market or "").strip().lower():
            return members.split()
    return []
