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
