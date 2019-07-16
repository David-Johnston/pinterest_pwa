﻿var CACHE_NAME = "Pinterest-pwa-v1";

const version = "1.01",
    preCache = "PRECACHE-" + version,
    dynamicCache = "DYNAMIC-" + version,
    cacheList = [
        "/",
        "src/App.js",
        "src/App.test.js",
        "src/index.js",
        "src/index.css",
        "src/masonry-docs.css",
        "src/masonry-docs.min.js",
        "src/registarServiceWorker.js",
        "src/components/Counter.js",
        "src/components/FetchData.js",
        "src/components/Home.js",
        "src/components/Layout.js",
        "src/components/NavMenu.css",
        "src/components/NavMenu.js",
        "src/store/configureStore.js",
        "src/store/Counter.js",
        "src/store/WeatherForecasts.js"
    ];

const $Notifications = {
  "fallbackURL": "_/_/push/web_push_content/",
  "default": {
    "title": "Fresh Pins!",
    "body": "You’ve got new Pins waiting for you on Pinterest.",
    "tag": "pinterest-push-notification-tag"
  },
  "duration": 300000,
  "template": "/mnt/pinboard/webapp/webpack/plugins/lib/swTemplates/notifications.js"
};
const $Log = {
  "notificationClicked": "_/_/push/web_push_click/"
};

function print(fn) {
  return function (message, group) {
    if ($DEBUG) {
      if (group && logger.groups[group]) {
        logger.groups[group].push({
          fn: fn,
          message: message
        });
      } else {
        console[fn].call(console, message);
      }
    }
  };
}

const logger = {
  groups: {},
  group: group => {
    logger.groups[group] = [];
  },
  groupEnd: group => {
    const groupLogs = logger.groups[group];
    if (groupLogs && groupLogs.length > 0) {
      console.groupCollapsed(group);
      groupLogs.forEach(log => {
        console[log.fn].call(console, log.message);
      });
      console.groupEnd();
    }
    delete logger.groups[group];
  },
  log: print('log'),
  warn: print('warn'),
  error: print('error')
};


/*         -------- CACHE LISTENERS ---------         */

self.addEventListener('install', handleInstall);
self.addEventListener('activate', handleActivate);


/*         -------- CACHE HANDLERS ---------         */

function handleInstall(event) {
  logger.log('Entering install handler.');
  self.skipWaiting();
  if ($Cache.precache) {
    event.waitUntil(precache());
  }
}

function handleActivate(event) {
  logger.log('Entering activate handler.');
  const cachesCleared = caches.keys().then((cacheNames) => {
    logger.group('cleanup');
    return Promise.all(
      cacheNames.map((cacheName) => {
        if (CURRENT_CACHE !== cacheName) {
          logger.log(`Deleting cache key: ${cacheName}`, 'cleanup');
          return caches.delete(cacheName);
        }
        return Promise.resolve();
      })
    ).then(() => logger.groupEnd('cleanup'));
  });
  event.waitUntil(cachesCleared);
}

function handleFetch(event) {
  if (isNavigation(event.request)) {
    if ($Cache.offline) {
      event.respondWith(
        fetchAndCacheAppShell(event.request)
          .catch(() => caches.match(APP_SHELL_CACHE))
          .catch(() => undefined)
      );
    }
  } else if (event.request.method === 'GET') {
    const strategy = getStrategyForUrl(event.request.url);
    if (strategy) {
      logger.group(event.request.url);
      logger.log(`Using strategy ${strategy.type}.`, event.request.url);
      event.respondWith(
        applyEventStrategy(strategy, event)
          .then((response) => {
            logger.groupEnd(event.request.url);
            return response;
          })
          .catch(() => undefined)
      );
    }
  }
}

/*         -------- CACHE HELPERS ---------         */

function applyEventStrategy(strategy, event) {
  const { request } = event;
  switch (strategy.type) {
    case 'offline-only':
      return fetchAndCache(request, strategy)().catch(getFromCache(request));
    case 'fallback-only':
      return fetchAndCache(request, strategy)().then(fallbackToCache(request));
    case 'prefer-cache':
      return getFromCache(request)().catch(fetchAndCache(request, strategy));
    case 'race':
      return getFromFastest(request, strategy)();
    default:
      return Promise.reject(`Strategy not supported: ${strategy.type}`);
  }
}

function insertInCache(request, response) {
  logger.log('Inserting in cache.', request.url);
  return caches.open(CURRENT_CACHE).then((cache) => cache.put(request, response));
}

function getFromCache(request) {
  return () =>
    caches.match(request).then((response) => {
      if (response) {
        logger.log('Found entry in cache.', request.url);
        return response;
      }
      logger.log('No entry found in cache.', request.url);
      throw new Error(`No cache entry found for ${request.url}`);
    });
}

function getStrategyForUrl(url) {
  if ($Cache.strategy) {
    return $Cache.strategy.find((strategy) =>
      strategy.matches.some((match) => {
        const regex = new RegExp(match);
        return regex.test(url);
      })
    );
  }
  return null;
}

function fetchAndCache(request) {
  return () => {
    logger.log('Fetching remote data.', request.url);
    return fetch(request).then((response) => {
      if (isResponseSafeToCache(response)) {
        logger.log('Caching remote response.', request.url);
        insertInCache(request, response.clone());
      } else {
        logger.log('Fetch error.', request.url);
      }
      return response;
    });
  };
}

function fetchAndCacheAppShell(request) {
  return fetch(request).then((response) => {
    if (isResponseSafeToCache(response)) {
      logger.log('Caching app shell.', request.url);
      insertInCache(APP_SHELL_CACHE, response.clone());
    }
    return response;
  });
}

function fallbackToCache(request) {
  return (response) => {
    if (!isResponseSafeToCache(response)) {
      return getFromCache(request)();
    }
    return response;
  };
}

function getFromFastest(request, strategy) {
  return () =>
    new Promise((resolve, reject) => {
      var errors = 0;

      function raceReject() {
        errors += 1;
        if (errors === 2) {
          reject(new Error('Network and cache both failed.'));
        }
      }

      function raceResolve(response) {
        if (response instanceof Response) {
          resolve(response);
        } else {
          raceReject();
        }
      }

      getFromCache(request)()
        .then(raceResolve)
        .catch(raceReject);

      fetchAndCache(request, strategy)()
        .then(raceResolve)
        .catch(raceReject);
    });
}

function precache() {
  logger.group('precaching');
  return caches
    .open(CURRENT_CACHE)
    .then((cache) =>
      Promise.all(
        $Cache.precache.map((urlToPrefetch) => {
          logger.log(urlToPrefetch, 'precaching');
          const cacheBustedUrl = new URL(urlToPrefetch, location.href);
          cacheBustedUrl.search += (cacheBustedUrl.search ? '&' : '?') + `cache-bust=${Date.now()}`;

          const request = new Request(cacheBustedUrl, { mode: 'cors' });
          return fetch(request).then((response) => {
            if (!isResponseSafeToCache(response)) {
              logger.error(`Failed for ${urlToPrefetch}.`, 'precaching');
              return undefined;
            }
            return cache.put(urlToPrefetch, response);
          });
        })
      )
    )
    .then(() => logger.groupEnd('precaching'));
}

'use strict';

/* global $Log, logger, self, fetch, clients, $Notifications */
/* eslint no-use-before-define:0 */

/*         -------- NOTIFICATIONS ---------         */

self.addEventListener('push', handleNotificationPush);
self.addEventListener('notificationclick', handleNotificationClick);

/*         -------- NOTIFICATIONS HANDLERS ---------         */

function handleNotificationPush(event) {
  logger.log('Push notification received');
  logAction('', '_/_/push/web_push_log/push_notification_received/');

  if ($Log.notificationReceived) {
    event.waitUntil(logNotificationReceived(event));
  }

  // Show notification or fallback
  if (event.data && event.data.title) {
    event.waitUntil(showNotification(event.data));
  } else if ($Notifications.fallbackURL) {
    event.waitUntil(
      self.registration.pushManager
        .getSubscription()
        .then(fetchNotification)
        .then(convertResponseToJson)
        .then(showNotification)
        .catch(showNotification)
    );
  } else {
    logger.warn('No notification.data and no fallbackURL.');
    event.waitUntil(showNotification());
  }
}

function handleNotificationClick(event) {
  logger.log('Push notification clicked.', event.notification.tag);
  logAction('', '_/_/push/web_push_log/push_notification_clicked/');

  if ($Log.notificationClicked) {
    event.waitUntil(logNotificationClick(event));
  }

  // Open the url if provided
  if (event.notification.data && event.notification.data.url) {
    const { url } = event.notification.data;
    event.waitUntil(openWindow(url));
  } else if (event.notification.tag.indexOf(':') !== -1) {
    // TODO: Deprecate
    const url = event.notification.tag.split(':')[2] || '/';
    event.waitUntil(openWindow(url));
  } else {
    logger.warn('Cannot route click with no data.url property. Using "/".', event.notification.tag);
    event.waitUntil(openWindow('/'));
  }

  event.notification.close();
  logger.groupEnd(event.notification.tag);
}

/*         -------- NOTIFICATIONS HELPERS ---------         */

function showNotification(data) {
  if (!data || !data.tag) {
    data = $Notifications.default;
  }
  logger.group(data.tag);
  logger.log('Show notification.', data.tag);
  logAction('', '_/_/push/web_push_log/call_google_show_notification_api/');
  return self.registration.showNotification(data.title, data).then(delayDismissNotification);
}

function fetchNotification(subscription) {
  if (!subscription) {
    logger.warn('No subscription found.');
    throw new Error('No subscription found.');
  }
  logger.log('Fetching remote notification data.');
  logAction('', '_/_/push/web_push_log/fetch_remote_notification_data/');
  const queries = {
    endpoint: subscription.endpoint,
  };
  const url = formatUrl($Notifications.fallbackURL, queries);
  return fetch(url, { credentials: 'include' });
}

function convertResponseToJson(response) {
  if (response.status !== 200) {
    throw new Error('Notification data fetch failed.');
  }
  logAction('', '_/_/push/web_push_log/convert_response_to_json/');
  return response.json();
}

function delayDismissNotification() {
  logAction('', '_/_/push/web_push_log/call_show_notification_success/');
  setTimeout(() => {
    self.registration.getNotifications().then((notifications) => {
      notifications.forEach((notification) => {
        notification.close();
        logger.log('Dismissing notification.', notification.tag);
        logger.groupEnd(notification.tag);
      });
    });
  }, $Notifications.duration || 5000);
}

function openWindow(url) {
  if (clients.openWindow) {
    return clients.openWindow(url);
  }
  return Promise.resolve();
}

function logNotificationReceived(event) {
  return logAction(event, $Log.notificationReceived);
}

function logNotificationClick(event) {
  return logAction(event.notification, $Log.notificationClicked);
}

function logAction(notification, url) {
  logger.log(`Send log event to ${url}.`, notification.tag);
  return self.registration.pushManager.getSubscription().then((subscription) => {
    const query = {
      endpoint: subscription.endpoint,
      tag: notification.tag,
    };
    return fetch(formatUrl(url, query), { credentials: 'include' });
  });
}

function formatUrl(url, queries) {
  const prefix = url.includes('?') ? '&' : '?';
  const query = Object.keys(queries)
    .map((key) => `${key}=${queries[key]}`)
    .join('&');
  return url + prefix + query;
}