/** The one place that knows where the site is published. Change it here if the repo is ever renamed. */
export const SITE = {
  owner: 'jbone707',
  repo: 'calendar-feeds',
  host: 'jbone707.github.io/calendar-feeds',
};

export const httpsUrl = (file: string) => `https://${SITE.host}/${file}`;
export const webcalUrl = (file: string) => `webcal://${SITE.host}/${file}`;
export const uidDomain = (feedId: string) => `${feedId}.${SITE.repo}.${SITE.owner}.github.io`;

export const USER_AGENT = `${SITE.repo}/1.0 (+https://github.com/${SITE.owner}/${SITE.repo}; personal calendar, a few requests per day)`;

/**
 * The household's time zone. Event times are written in this zone (with the rules below) instead of UTC, because
 * Apple Calendar shows a second "(1AM GMT)" time on every entry whose time is written in UTC. The instants are
 * identical either way; a phone in another zone still converts correctly.
 */
export const HOME_TZ = {
  id: 'America/Los_Angeles',
  // US daylight-saving rules in force since 2007.
  vtimezone: [
    'BEGIN:VTIMEZONE',
    'TZID:America/Los_Angeles',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0800',
    'TZOFFSETTO:-0700',
    'TZNAME:PDT',
    'DTSTART:20070311T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0700',
    'TZOFFSETTO:-0800',
    'TZNAME:PST',
    'DTSTART:20071104T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ],
};
