module.exports = AirbnbConnector;

var Q = require('q');
var _ = require('lodash');
var request = require('request-promise');

var searchThrottleMilliseconds = 30 * 1000;
var calendarDaysThrottleMilliseconds = 0.3 * 1000;
var searchMaxResults = 50;
var searchMaxListing = 1000;

function AirbnbConnector(clientId) {
    this.fetch = fetch;
    this.calendarDays = calendarDays;

    function getCalendarDetails(calendarDaysResult) {
        var calendarDays = _.map(calendarDaysResult, function (calendarDay) {
            return calendarDay.available;
        });
        var available = _.compact(calendarDays).length;
        var days = calendarDays.length;
        return {calendarDays: calendarDays, available: available, days: days};
    }

    function calendarDays(id) {
        return execute('calendar_days', {listingId: id})
            .then(function (result) {
                return getCalendarDetails(result.calendar_days);
            })
            .catch(function (err) {
                console.log(err);
            });
    }

    function buildOptions(func, query) {
        var qs = _.assign({client_id: clientId}, query);
        return {
            uri: 'https://api.airbnb.com/v2/' + func,
            qs: qs,
            json: true
        };
    }

    function customizeQuery(query) {
        var qs = {};
        var underscorePrefix = ['limit', 'offset'];
        _.forOwn(query, function (value, key) {
            key = _.includes(underscorePrefix, key) ? '_' + key : _.snakeCase(key);
            qs[key] = value;
        });
        return qs;
    }

    function execute(func, query) {
        var options = buildOptions(func, customizeQuery(query));
        return request(options);
    }

    function retryExecute(func, query, wait) {
        return execute(func, query)
            .catch(function (error) {
                var deferred = Q.defer();
                setTimeout(function () {
                    console.log('retry');
                    deferred.resolve(retryExecute(func, query, wait));
                }, wait);
                return deferred.promise;
            });
    }

    function throttleCalendarExecute(queries, wait) {
        var counter = 0;
        return Q.all(_.map(queries, function (query, i) {
            var deferred = Q.defer();
            setTimeout(function () {
                retryExecute('calendar_days', query, calendarDaysThrottleMilliseconds)
                    .then(function (data) {
                        console.log((++counter) + '/' + queries.length);
                        return data;
                    })
                    .then(deferred.resolve);
            }, wait * (i + 1));
            return deferred.promise;
        }));
    }

    function generateCalendarQueries(properties) {
        return _.map(properties, function (result) {
            return {listingId: result.listing.id};
        });
    }

    function enrichCalendars(propertiesArray) {
        var properties = {};
        var queries = generateCalendarQueries(propertiesArray);
        return throttleCalendarExecute(queries, calendarDaysThrottleMilliseconds)
            .then(function (calendars) {
                _.forEach(calendars, function (calendar, i) {
                    var id = queries[i].listingId;
                    propertiesArray[i].calendar = calendar;
                    properties[id] = propertiesArray[i];
                });
                return properties;
            });
    }

    function fetch(query, amount) {
        return throttleSearchExecute(query, amount)
            .then(enrichCalendars);
    }

    function getQuery(base, total, offset, price) {
        var limit = Math.min(searchMaxResults, total, searchMaxListing - offset);
        var query = _.cloneDeep(base);
        query.limit = limit;
        query.offset = offset;
        query.priceMin = price.min;
        query.priceMax = price.max;
        return query;
    }

    function throttleSearchExecute(base, amount, min, max, offset, properties) {
        properties = properties || [];
        min = min || 0;
        max = max || 100;
        offset = offset || 0;
        if (!amount) {
            return Q.resolve(properties);
        }
        var query = getQuery(base, amount, offset, {min: min, max: max});
        return retryExecute('search_results', query, searchThrottleMilliseconds)
            .then(function (data) {
                var beforeReceived = properties.length;
                properties = appendProperties(properties, data.search_results);
                var received = properties.length - beforeReceived;
                console.log(properties.length + '/' + (beforeReceived + amount));
                offset += query.limit;
                if (received < query.limit || query.limit < searchMaxResults) {
                    offset = 0;
                    min = max + 1;
                    max += 100;
                }
                var deferred = Q.defer();
                setTimeout(function () {
                    deferred.resolve(throttleSearchExecute(base, amount - received, min, max, offset, properties));
                }, searchThrottleMilliseconds);
                return deferred.promise;
            });
    }

    function appendProperties(properties, searchResults) {
        var unionResults = _.concat(properties, searchResults);
        return _.uniqBy(unionResults, function (property) {
            return property.listing.id;
        });
    }
}