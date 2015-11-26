'use strict';

var dataMiningControllers = angular.module('dataMiningControllers', []);

dataMiningControllers.controller('DataMiningCtrl', ['$scope', 'YQLHelper',
    function ($scope, YQLHelper) {
        $scope.inputStockCode = '0001.HK';
        $scope.inputStartDate = '2009-10-01';
        $scope.inputEndDate = '2014-10-01';
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
     '$window', 'google', 'StrategyProcessor', 'StatHelper', 'DatasetPreparator',
    function ($scope, YQLHelper, PairCalculator, $q, PairCrawler, StockCategories,
              $window, google, StrategyProcessor, StatHelper, DatasetPreparator) {

        $scope.calculationRules = Object.keys(PairCalculator).filter(function(funcName){
            return funcName.indexOf('_') != 0;
        }).map(function(funcName) {
            var ruleName = funcName.replace(/([A-Z])/g, ' $1').slice(funcName.indexOf('by ') + 3);
            return {name: ruleName, funcName: funcName};
        });
        $scope.stockCategories = ([{name: 'Stock Category'}]).concat(StockCategories);
        $scope.$watch('stockCategory', function(newValue, oldValue) {
            if (newValue) $scope.stockList = newValue.stocks;
        });

        $scope.startDate = '2009-10-01';
        $scope.endDate = '2014-10-01';
        $scope.stockCategory = $scope.stockCategories[0];

        $scope.findPair = function() {
            if (!$scope.stockCode1 || !$scope.stockCode2 || !$scope.startDate ||
                !$scope.endDate || !$scope.pairingRule) {
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
            if (!$scope.startDate || !$scope.endDate || !$scope.pairingRule ||
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

        $scope.clickRowData = function(score) {
            if (!score.dataset) {
                $scope.openComparingPage(score.stock1, scorestock2);
                return;
            }
            $scope.pair = score;
            $scope.drawScoreGraph(score.dataset, '.graph-1', function() {
                $scope.drawValuesGraph(score.dataset, '.graph-2', function() {
                    $scope.pair.dataset = DatasetPreparator.makeRelativePriceRatio(
                        $scope.pair.dataset
                    ); 
                    $scope.drawOneVariableGraph(score.dataset, 'priceRatio', '.graph-3');
                });
            });
            $scope.strategiesResults = null;
            $('.modal').modal('show');
        };

        $scope.openComparingPage = function(stock1, stock2) {
            var url = 'https://hk.finance.yahoo.com/q/bc?t=2y&s={stock1}&l=on&z=l&q=l&c={stock2}&ql=1';
            url = url.replace('{stock1}', stock1).replace('{stock2}', stock2);
            $window.open(url);
        };

        var baseGoogleChartOptions = {
            legend: 'none',
            width: '650',
            height: 450,
            lineWidth: 1,
            vAxis: {
                // viewWindow: {max: 2, min: -2},
                baseline: 0,
                format: '#.##'
            },
            hAxis: {gridlines: {count: 10}},
            chartArea: {
                width: '80%',
                height: '80%'
            }
        };

        $scope.drawOneVariableGraph = function(dataset, variableName, targetDiv, callback) {
            if (!dataset) return;
            if (!callback) callback = angular.noop;
            var data = new google.visualization.DataTable();
            data.addColumn('number', 'Day');
            data.addColumn('number');
            data.addRows(dataset.map(function(row) {
                return [row.day, row[variableName]];
            }));
            var targetEl = angular.element(targetDiv)[0];
            var chart = new google.visualization.LineChart(targetEl);
            google.visualization.events.addOneTimeListener(chart, 'ready', callback)
            chart.draw(data, baseGoogleChartOptions);
        };

        $scope.drawScoreGraph = function(dataset, targetDiv, callback) {
            $scope.drawOneVariableGraph(dataset, 'deltaValue', targetDiv, callback);
        };

        $scope.drawValuesGraph = function(dataset, targetDiv, callback) {
            if (!dataset) return;
            if (!callback) callback = angular.noop;
            var data = new google.visualization.DataTable();
            data.addColumn('number', 'Day');
            data.addColumn('number', 'Stock1');
            data.addColumn('number', 'Stock2');
            data.addRows(dataset.map(function(row) {
                return [row.day, row.stock1Value, row.stock2Value];
            }));
            var targetEl = angular.element(targetDiv)[0];
            var chart = new google.visualization.LineChart(targetEl);
            google.visualization.events.addOneTimeListener(chart, 'ready', callback)
            chart.draw(data, baseGoogleChartOptions);
        }

        $scope.targetStartDate = '2014-10-01';
        $scope.targetEndDate = '2015-10-01';
        $scope.doAllStrategy = function() {
            if (!$scope.targetStartDate || !$scope.targetEndDate ||
                $scope.pairDataset) {
                return;
            }
            var getDataPromise = function(stockCode) {
                return YQLHelper.getHistoricalDataViaServer(
                    stockCode,
                    new Date($scope.targetStartDate),
                    new Date($scope.targetEndDate)
                );
            }
            var promise1 = getDataPromise($scope.pair.stock1);
            var promise2 = getDataPromise($scope.pair.stock2);
            $q.all([promise1, promise2]).then(function(responses) {
                // var preDefined = {
                //     mean1: StatHelper.mean($scope.pair.dataset, 'stock1Price'),
                //     mean2: StatHelper.mean($scope.pair.dataset, 'stock2Price'),
                //     std1: StatHelper.std($scope.pair.dataset, 'stock1Price'),
                //     std2: StatHelper.std($scope.pair.dataset, 'stock2Price')
                // };
                // var targetData = PairCalculator[$scope.pairingRule](
                //     responses[0].data.results,
                //     responses[1].data.results,
                //     preDefined
                // );
                var stockData1 = responses[0].data.results;
                var stockData2 = responses[1].data.results;
                var targetDataset =  DatasetPreparator.makeSimpleDataset(stockData1, stockData2);
                var historicDataset = DatasetPreparator.makeRelativePriceRatio($scope.pair.dataset);
                targetDataset = DatasetPreparator.makeRelativePriceRatio(targetDataset);
                $scope.drawOneVariableGraph(targetDataset, 'priceRatio', '.targetGraph');
                $scope.strategiesResults = StrategyProcessor.doAllStrategies(
                    historicDataset,
                    targetDataset
                );
                console.log($scope.strategiesResults);
            });
        };

    }]
)