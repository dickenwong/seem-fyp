'use strict';

var dataMiningControllers = angular.module('dataMiningControllers', []);

dataMiningControllers.controller('DataMiningCtrl', ['$scope', 'YQLHelper',
    function ($scope, YQLHelper) {
        $scope.inputStockCode = '0001.HK';
        $scope.inputStartDate = '2014-01-01';
        $scope.inputEndDate = '2015-01-01';
        $scope.inputYQL = '';
        $scope.dataResults = [];

        $scope.getStockHistoricalData = function() {
            if (!$scope.inputStockCode || !$scope.inputStartDate || !$scope.inputEndDate) {
                return;
            }
            $scope.message = 'Retrieving...';
            $scope.quoteData = [];
            $scope.dataAttrs = [];
            YQLHelper.cancelAll();
            var promise = YQLHelper.getHistoricalDataViaServer(
                $scope.inputStockCode,
                new Date($scope.inputStartDate),
                new Date($scope.inputEndDate)
            );
            promise.then(function (resp) {
                console.log(resp);
                if (resp.data.results.length == 0) {
                    $scope.message = '* Empty data. Please check your input.';
                    return;
                }
                $scope.message = null;
                $scope.dataAttrs = resp.data.headersInOrder;
                $scope.quoteData = resp.data.results;
            }, function error(resp) {
                console.log(resp);
                if (resp.status != -1) {
                    $scope.message = '* Cannot load data. Please check your input.';
                }
            });
        };


    }
]);

dataMiningControllers.controller('PairFinderCtrl',
    ['$scope', 'YQLHelper', 'PairCalculator', '$q', 'PairCrawler', 'StockCategories',
     '$window',
    function ($scope, YQLHelper, PairCalculator, $q, PairCrawler, StockCategories,
              $window) {

        $scope.calculationRules = Object.keys(PairCalculator).map(function(funcName) {
            var ruleName = funcName.replace(/([A-Z])/g, ' $1').slice(funcName.indexOf('by ') + 3);
            return {name: ruleName, funcName: funcName};
        });
        $scope.stockCategories = ([{name: 'Stock Category'}]).concat(StockCategories);
        $scope.$watch('stockCategory', function(newValue, oldValue) {
            if (newValue) $scope.stockList = newValue.stocks;
        });

        $scope.startDate = '2013-01-01';
        $scope.endDate = '2015-01-01';
        $scope.stockCategory = $scope.stockCategories[0];

        $scope.findPair = function() {
            if (!$scope.stockCode1 ||
                !$scope.stockCode2 ||
                !$scope.startDate ||
                !$scope.endDate ||
                !$scope.pairingRule) {
                return;
            }
            $scope.message = 'Calculating...';
            YQLHelper.cancelAll();
            var getDataPromise = function(stockCode) {
                return YQLHelper.getHistoricalDataViaServer(
                    stockCode,
                    new Date($scope.startDate),
                    new Date($scope.endDate)
                );
            }
            var promise1 = getDataPromise($scope.stockCode1);
            var promise2 = getDataPromise($scope.stockCode2);
            $q.all([promise1, promise2]).then(function(responses) {
                var score = PairCalculator.byLeastSquare(
                    responses[0].data.results,
                    responses[1].data.results
                );
            });

        };

        $scope.crawl = function() {
            if (!$scope.startDate ||
                !$scope.endDate ||
                !$scope.pairingRule ||
                !$scope.stockList) {
                return;
            }
            $scope.scores = [];
            $scope.message = 'Calculating...';
            YQLHelper.cancelAll();
            PairCrawler.importStockPool($scope.stockList);
            PairCrawler.crawl(
                $scope.pairingRule,
                new Date($scope.startDate),
                new Date($scope.endDate)
            ).then(function(scores) {
                scores.sort(function(a, b) {
                    if (isNaN(a.score) && isNaN(a.score)) return 0;
                    if (isNaN(a.score)) return 1;
                    if (isNaN(b.score)) return -1;
                    return a.score > b.score? 1 : -1;
                });
                $scope.scores = scores;
                $scope.message = null;
            }, function() {
                $scope.message = 'Error! Please try again.';
            });
        };


        $scope.openComparingPage = function(stock1, stock2) {
            var url = 'https://hk.finance.yahoo.com/q/bc?t=2y&s={stock1}&l=on&z=l&q=l&c={stock2}&ql=1';
            url = url.replace('{stock1}', stock1).replace('{stock2}', stock2);
            $window.open(url);
        };

    }]
)