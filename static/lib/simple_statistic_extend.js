(function(ss) {
    'use strict';

    function weightedLinearRegession(data, weights) {

        var sumX = 0;
        var sumY = 0;
        var sumWeight = 0;

        data.forEach(function(point, i) {
            var weight = weights[i] || 0;
            sumWeight += weight;
            sumX += weight * point[0];;
            sumY += weight * point[1];
        });

        var meanX = sumX / sumWeight;
        var meanY = sumY / sumWeight;

        var upper = 0;
        var lower = 0;
        data.forEach(function(point, i) {
            var weight = weights[i] || 0;
            upper += weight * (point[0] - meanX) * (point[1] - meanY);
            lower += weight * (point[0] - meanX) * (point[0] - meanX);
        });
        var m = upper / lower;
        var c = meanY - m * meanX;

        return {m: m, b: c};

    }


    function weightedRSquared(data, weights, regressionLineFunc) {

        var sumY = 0;
        var sumWeight = 0;

        data.forEach(function(point, i) {
            var weight = weights[i] || 0;
            sumWeight += weight;
            sumY += weight * point[1];
        });

        var meanY = sumY / sumWeight;

        var TSS = 0;
        var RSS = 0;
        data.forEach(function(point, i) {
            var weight = weights[i] || 0;
            TSS += weight * Math.pow(point[1] - meanY, 2);
            RSS += weight * Math.pow(point[1] - regressionLineFunc(point[0]), 2);
        });

        return 1 - RSS / TSS;

    }

    ss.weightedLinearRegession = weightedLinearRegession;
    ss.weightedRSquared = weightedRSquared;

})(window.ss);