'use strict';

var dataMiningControllers = angular.module('dataMiningControllers', []);

dataMiningControllers.controller('DataMiningCtrl', ['$scope', 'YQLHelper',
    function ($scope, YQLHelper) {
        $scope.inputStockCode = '0001.HK';
        $scope.inputStartDate = '2008-10-01';
        $scope.inputEndDate = '2013-10-01';
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
     'StrategyList',
    function ($scope, YQLHelper, PairCalculator, $q, PairCrawler, StockCategories,
              $window, google, StrategyProcessor, StatHelper, DatasetPreparator,
              StrategyList) {

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

        $scope.startDate = '2008-10-01';
        $scope.endDate = '2013-10-01';
        $scope.stockCategory = $scope.stockCategories[0];

        var _getDataPromise = function(stockCode, startDate, endDate) {
            return YQLHelper.getHistoricalDataViaServer(
                stockCode,
                new Date(startDate),
                new Date(endDate)
            );
        };

        var _getMultipleDataPromises = function(stockCodes, startDate, endDate) {
            var promises = [];
            var s = new Date(startDate);
            var e = new Date(endDate);
            stockCodes.forEach(function(stockCode) {
                promises.push(YQLHelper.getHistoricalDataViaServer(stockCode, s, e));
            });
            return $q.all(promises);
        };

        $scope.findPair = function() {
            if (!$scope.stockCode1 || !$scope.stockCode2 || !$scope.startDate ||
                !$scope.endDate || !$scope.pairingRule) {
                return;
            }
            $scope.message = 'Calculating...';
            YQLHelper.cancelAll();
            var promise1 = _getDataPromise(
                $scope.stockCode1, 
                $scope.startDate, 
                $scope.endDate
            );
            var promise2 = _getDataPromise(
                $scope.stockCode2, 
                $scope.startDate, 
                $scope.endDate
            );
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
                scores = scores.filter(function(score) {
                    if (isNaN(score.score)) return false;
                    return true;
                });
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
                    $scope.drawGraphWithStd(score.dataset, 'priceRatio', null, '.graph-3');
                });
            });
            $scope.strategiesResults = null;
            $scope.doAllStrategy();
            angular.element('.pair-detail-modal').modal('show');
        };

        $scope.openComparingPage = function(stock1, stock2) {
            var url = 'https://hk.finance.yahoo.com/q/bc?t=2y&s={stock1}&l=on&z=l&q=l&c={stock2}&ql=1';
            url = url.replace('{stock1}', stock1).replace('{stock2}', stock2);
            $window.open(url);
        };

        var baseGoogleChartOptions = {
            legend: {position: 'right', alignment: 'center'},
            width: 750,
            height: 450,
            lineWidth: 1,
            vAxis: {format: '#.##'},
            hAxis: {gridlines: {color: '#eee'}, title: 'Date'},
            crosshair: { trigger: 'both', opacity: '0.5'},
            chartArea: {
                width: '75%',
                height: '80%',
                left: '8%'
            }
        };

        $scope.drawOneVariableGraph = function(dataset, variableName, option, targetDiv, callback) {
            if (!dataset) return;
            if (!callback) callback = angular.noop;
            var chartOptions = baseGoogleChartOptions;
            var data = new google.visualization.DataTable();
            var variableColName = typeof variableName === 'string' && variableName.length > 1 ? (
                variableName.slice(0, 1).toUpperCase() +
                variableName.slice(1).replace(/([A-Z])/g, ' $1')
            ) : variableName;
            data.addColumn('date', 'Day');
            if (option && option.extraColumns) {
                option.extraColumns.forEach(function(col) {
                    data.addColumn('number', col.name);
                });
            }
            data.addColumn('number', variableColName);
            data.addRows(dataset.map(function(row, i) {
                var records = [new Date(row.date), row[variableName]];
                if (option && option.extraColumns) {
                    option.extraColumns.forEach(function(col, i) {
                        records.splice(i+1, 0, col.data[i]);
                    });
                }
                return records
            }));
            if (option && option.extraColumns) {
                var series = option.extraColumns.map(function(col) {return col.options;});
                if (chartOptions.series) series.push(chartOptions.series[0] || null);
                chartOptions = angular.extend({}, chartOptions, {series: series});
            }
            var targetEl = angular.element(targetDiv)[0];
            var chart = new google.visualization.LineChart(targetEl);
            google.visualization.events.addOneTimeListener(chart, 'ready', callback)
            chart.draw(data, chartOptions);
        };

        $scope.drawScoreGraph = function(dataset, targetDiv, callback) {
            $scope.drawOneVariableGraph(dataset, 'deltaValue', null, targetDiv, callback);
        };

        $scope.drawValuesGraph = function(dataset, targetDiv, callback) {
            if (!dataset) return;
            if (!callback) callback = angular.noop;
            var data = new google.visualization.DataTable();
            data.addColumn('date', 'Date');
            data.addColumn('number', 'Stock1');
            data.addColumn('number', 'Stock2');
            data.addRows(dataset.map(function(row) {
                return [new Date(row.date), row.stock1Value, row.stock2Value];
            }));
            var targetEl = angular.element(targetDiv)[0];
            var chart = new google.visualization.LineChart(targetEl);
            google.visualization.events.addOneTimeListener(chart, 'ready', callback)
            chart.draw(data, baseGoogleChartOptions);
        }

        $scope.drawGraphWithStd = function(dataset, variableName, option, targetDiv, callback) {
            if (variableName == null) variableName = 'priceRatio';
            if (option == null) option = {};
            var mean = option.mean || StatHelper.mean(dataset, variableName);
            var std = option.std || StatHelper.std(dataset, variableName);
            option.extraColumns = ([2, 1, 0, -1, -2]).map(function(numOfstd) {
                return {
                    name: 'mean' + (numOfstd == 0? '' : (numOfstd > 0?
                        (' + ' + numOfstd) : (' - ' + (numOfstd * -1) ) + ' sd')),
                    data: dataset.map(function() {return -std * numOfstd + mean;}),
                    options: {
                        lineWidth: 1.5,
                        lineDashStyle: [4, 2],
                        enableInteractivity: false,
                        tooltip: 'none'
                    }
                };
            });
            delete option.mean;
            delete option.std;
            $scope.drawOneVariableGraph(dataset, variableName, option, targetDiv, callback);
        };

        var _prepareStrategyDataset = function(stock1, stock2, targetStartDate, targetEndDate, historicDataset) {
            return _getMultipleDataPromises(
                [stock1, stock2],
                $scope.targetStartDate,
                $scope.targetEndDate
            ).then(function(responses) {
                var stockData1 = responses[0].data.results;
                var stockData2 = responses[1].data.results;
                var targetDataset =  DatasetPreparator.makeSimpleDataset(stockData1, stockData2);
                targetDataset = DatasetPreparator.makeRelativePriceRatio(targetDataset);
                historicDataset = DatasetPreparator.makeRelativePriceRatio(historicDataset);
                return {
                    stockData1: stockData1,
                    stockData2: stockData2,
                    targetDataset: targetDataset,
                    historicDataset: historicDataset
                };
            });
        };

        $scope.targetStartDate = '2013-10-01';
        $scope.targetEndDate = '2015-10-01';
        $scope.doAllStrategy = function() {
            if (!$scope.targetStartDate || !$scope.targetEndDate ||
                $scope.pairDataset) {
                return;
            }
            _prepareStrategyDataset(
                $scope.pair.stock1,
                $scope.pair.stock2,
                $scope.targetStartDate,
                $scope.targetEndDate,
                $scope.pair.dataset
            ).then(function (params) {
                $scope.strategiesResults = StrategyProcessor.doAllStrategies(
                    params.historicDataset,
                    params.targetDataset
                );
                var mean = StatHelper.mean(params.historicDataset, 'priceRatio');
                var std = StatHelper.std(params.historicDataset, 'priceRatio');
                $scope.drawGraphWithStd(
                    params.targetDataset,
                    'priceRatio',
                    {mean: mean, std: std},
                    '.targetGraph'
                );
                console.log($scope.strategiesResults);
            });
        };

        var _doStrategiesOnTopPairs = function(pairPool, numOfPair, targetStartDate, targetEndDate) {
            var promises = [];
            var strategyTests = [];
            pairPool.forEach(function(pair, i) {
                if (i >= numOfPair) return false;
               var promise = _prepareStrategyDataset(
                    pair.stock1,
                    pair.stock2,
                    targetStartDate,
                    targetEndDate,
                    pair.dataset
                ).then(function (params) {
                    strategyTests.push({
                        top: i,
                        pair: pair,
                        results: StrategyProcessor.doAllStrategies(
                            params.historicDataset,
                            params.targetDataset
                        )
                    });
                });
                promises.push(promise);
            });
            return $q.all(promises).then(function() {return strategyTests;});
        };

        var _getStrategyProfts = function(strategyTests) {
            var strategyProfits = [];
            strategyTests.forEach(function(strategyTest) {
                strategyTest.results.forEach(function(result) {
                    var i = StrategyList.indexOf(result.strategy);
                    if (!strategyProfits[i]) {
                        strategyProfits[i] = {strategy: result.strategy};
                    }
                    var profit = result.result.forceClosedProfit;
                    var transactionCost = result.result.forceClosedTransactionCost;
                    var netProfit = profit - transactionCost;
                    if (strategyTest.top < 3) {
                        strategyProfits[i].totalTop3Profit = netProfit +
                            (strategyProfits[i].totalTop3Profit || 0);
                    }
                    if (strategyTest.top < 10) {
                        strategyProfits[i].totalTop10Profit = netProfit +
                            (strategyProfits[i].totalTop10Profit || 0);
                    }
                    if (netProfit > (strategyProfits[i].maxProfit || 0)) {
                        strategyProfits[i].maxProfit = netProfit;
                    }
                    if (netProfit < (strategyProfits[i].minProfit || 0)) {
                        strategyProfits[i].minProfit = netProfit;
                    }
                    // console.log('Pair %s - %s, Strategy %d, Profit ' + netProfit, 
                    //     strategyTest.pair.stock1, 
                    //     strategyTest.pair.stock2,
                    //     i
                    // );
                });
            });
            return strategyProfits;
        };

        $scope.getStrategySummary = function() {
            angular.element('.strategy-summary-modal').modal('show');
            $scope.strategySummary = {};
            _doStrategiesOnTopPairs(
                $scope.scores, 
                10, 
                $scope.targetStartDate, 
                $scope.targetEndDate
            ).then(function(strategyTests) {
                console.log(strategyTests);
                $scope.strategySummary.strategyProfits = _getStrategyProfts(strategyTests);

            });
        };

    }]
)