var Q = require('q');
var fs = require('fs');
var _ = require('lodash');

var config = require('./config');

var AirbnbConnector = require('./airbnb-connector');
var airbnb = new AirbnbConnector(config.airbnb.clientId);

function execute(location, amount) {
    getProperties(location, amount)
        .then(function (properties) {
            printCount(properties);
            var demandMetric = calculateDemandMetric(properties);
            var result = parseResults(demandMetric);
            save(config.outputFile, result);
        })
        .catch(function (err) {
            console.log(err);
        })
}

function printCount(properties) {
    for (var i = 0; i < properties.length; i++) o[properties[i].listing.id] = 0;
    console.log('properties count: %d', _.keys(o).length);
}

function getProperties(location, amount) {
    return airbnb.fetch({location: location}, amount);
}

function calculateDemandMetric(properties) {
    var max = _.reduce(properties, function (max, property) {
        var pricePerAdult = property.pricing_quote.nightly_price / property.pricing_quote.guest_details.number_of_adults;
        return {
            reviews: Math.max(max.reviews, property.listing.reviews_count),
            price: Math.max(max.price, pricePerAdult)
        };
    }, 0);
    _.forOwn(properties, function (listingId, property) {
            var pricePerAdult = property.pricing_quote.nightly_price / property.pricing_quote.guest_details.number_of_adults;
            var price = pricePerAdult / max.price;
            var reviews = property.listing.reviews_count / max.reviews;
            var availability = 1 - (property.calendar.available / property.calendar.days);
            var rate = property.listing.star_rating / 5;
            property.weight = (0.4 * rate) + (0.3 * availability) + (0.2 * reviews) + (0.1 * price);
        }
    );
    return properties;
}

function parseResults(demandMetric) {
    var result = {};
    _.forEach(demandMetric, function (property) {
        result[property.listing.id] = parseResult(property);
    });
}

function parseResult(property) {
    return {
        lat: property.listing.lat,
        lng: property.listing.lng,
        weight: property.weight
    };
}

function save(fileName, json) {
    fs.writeFile(fileName, json, function (err) {
        if (err) return console.log(err);
    });
}

execute(config.location, config.propertiesCount);