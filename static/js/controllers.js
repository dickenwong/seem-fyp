'use strict';

var dataMiningControllers = angular.module('dataMiningControllers', []);

dataMiningControllers.controller('DataMiningCtrl', ['$scope', 'YQLHelper',
    function ($scope, YQLHelper) {
        $scope.inputStockCode = '0001.HK';
        $scope.inputStartDate = '2013-01-01';
        $scope.inputEndDate = '2015-12-31';
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
     'StrategyList', '$filter', '$timeout',
    function ($scope, YQLHelper, PairCalculator, $q, PairCrawler, StockCategories,
              $window, google, StrategyProcessor, StatHelper, DatasetPreparator,
              StrategyList, $filter, $timeout) {

        $scope.calculationRules = Object.keys(PairCalculator)
            .filter(function(funcName){
                return funcName.indexOf('_') != 0;
            })
            .map(function(funcName) {
                var ruleName = funcName
                    .replace(/([A-Z])/g, ' $1')
                    .slice(funcName.indexOf('by ') + 3);
                return {name: ruleName, funcName: funcName};
            });
        $scope.stockCategories = ([{name: 'Stock Category'}]).concat(StockCategories);

        $scope.$watch('stockCategory', function(newVal, oldVal) {
            if (newVal) $scope.stockList = newVal.stocks;
        });

        $scope.startDate = '2009-01-01';
        $scope.endDate = '2013-12-31';
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

        var _getMultipleDataPromises = function(stockCodes, startDate, endDate) {
            var promises = stockCodes.map(function(stockCode) {
                return YQLHelper.getHistoricalDataViaServer(
                    stockCode,
                    new Date(startDate),
                    new Date(endDate)
                );
            });
            return $q.all(promises);
        };

        // Deprecated
        // $scope.findPair = function() {
        //     if (!$scope.stockCode1 || !$scope.stockCode2 || !$scope.startDate ||
        //         !$scope.endDate || !$scope.pairingRule) {
        //         return;
        //     }
        //     $scope.message = 'Calculating...';
        //     YQLHelper.cancelAll();
        //     var promise1 = _getDataPromise(
        //         $scope.stockCode1,
        //         $scope.startDate,
        //         $scope.endDate
        //     );
        //     var promise2 = _getDataPromise(
        //         $scope.stockCode2,
        //         $scope.startDate,
        //         $scope.endDate
        //     );
        //     $q.all([promise1, promise2]).then(function(responses) {
        //         var score = PairCalculator.byLeastSquare(
        //             responses[0].data.results,
        //             responses[1].data.results
        //         );
        //     });
        // };

        var _cachedScoresList = [];
        $window._cachedScoresList = _cachedScoresList;
        var _getCachedScores = function(stockList, pairingRule, startDate, endDate) {
            var scores = null;
            _cachedScoresList.forEach(function(cachedScores, i) {
                if (cachedScores.stockList == stockList &&
                    cachedScores.pairingRule == pairingRule &&
                    cachedScores.startDate == startDate &&
                    cachedScores.endDate == endDate) {
                    scores = cachedScores.scores;
                    return false;
                }
            });
            return scores;
        };
        var _cacheScores = function(scores, stockList, pairingRule, startDate, endDate) {
            _cachedScoresList.forEach(function(cachedScores, i) {
                if (cachedScores.stockList == stockList &&
                    cachedScores.pairingRule == pairingRule &&
                    cachedScores.startDate == startDate &&
                    cachedScores.endDate == endDate) {
                    _cachedScoresList.splice(i, 1);
                    return false;
                }
            });
            _cachedScoresList.push({
                stockList: stockList,
                pairingRule: pairingRule,
                startDate: startDate,
                endDate: endDate,
                scores: scores
            });
        };
        $scope.crawl = function() {
            if (!$scope.startDate || !$scope.endDate || !$scope.pairingRule ||
                !$scope.stockList) {
                return;
            }
            $scope.scores = [];
            $scope.message = 'Calculating...';
            var cachedScores = _getCachedScores(
                $scope.stockList,
                $scope.pairingRule,
                $scope.startDate,
                $scope.endDate
            );
            if (cachedScores) {
                $scope.scores = cachedScores;
                $scope.message = null;
                return;
            }
            YQLHelper.cancelAll();
            $timeout(function() {
                var pairCrawled = 0;
                PairCrawler.importStockPool($scope.stockList);
                PairCrawler.crawl(
                    $scope.pairingRule,
                    new Date($scope.startDate),
                    new Date($scope.endDate)
                ).then(function(scores) {
                    var start = new Date($scope.startDate);
                    var end = new Date($scope.endDate);
                    var dayRange = (end - start) / 1000 / 60 / 60 / 24;
                    scores = scores.filter(function(score) {
                        if (isNaN(score.score)) return false;
                        if (score.dayCounts < dayRange * 0.4) return false;
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
                    _cacheScores(
                        $scope.scores,
                        $scope.stockList,
                        $scope.pairingRule,
                        $scope.startDate,
                        $scope.endDate
                    );
                }, function() {
                    $scope.message = 'Error! Please try again.';
                });
            }, 100);
        };

        $scope.clickRowData = function(score) {
            if (!score.dataset) {
                $scope.openComparingPage(score.stock1, score.stock2);
                return;
            }
            $scope.pair = score;
            $scope.drawScoreGraph(score.dataset, '.graph-1', function() {
                $scope.drawValuesGraph(score, '.graph-2', function() {
                    var rule = PairCalculator[$scope.pairingRule];
                    rule.strategy.prepare(score.dataset);
                    $scope.drawGraphWithStd(
                        score.dataset,
                        rule.strategy.dependentVariableName,
                        null,
                        '.graph-3'
                    );
                });
            });
            $scope.strategiesResults = null;
            $scope.strategyResult = null;
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
            height: 350,
            lineWidth: 1,
            vAxis: {format: '#.##'},
            hAxis: {
                gridlines: {color: '#eee'},
                title: 'Date'
            },
            crosshair: { trigger: 'focus', opacity: '0.5'},
            tooltip: { trigger: 'focus' },
            selectionMode: 'multiple',
            chartArea: {
                width: '72%',
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
                    option.extraColumns.forEach(function(col, j) {
                        records.splice(j+1, 0, col.data[i]);
                    });
                }
                return records
            }));
            if (option && option.extraColumns) {
                var series = option.extraColumns.map(function(col) {return col.options;});
                if (chartOptions.series) series.push(chartOptions.series[0] || null);
                chartOptions = angular.extend({}, chartOptions, {series: series});
            }
            if (option && option.points) {
                var pointColIndex = data.addColumn({type: 'string', role: 'style'});
                option.points.forEach(function(point) {
                    var rowIndices = data.getFilteredRows(point.filter);
                    rowIndices.forEach(function(rowI) {
                        data.setCell(rowI, pointColIndex, point.style || 'point {shape-type: circle;}');
                    });
                });
            }

            var targetEl = angular.element(targetDiv)[0];
            var chart = new google.visualization.LineChart(targetEl);
            google.visualization.events.addOneTimeListener(chart, 'ready', callback)
            chart.draw(data, chartOptions);
            return {chart: chart, data: data};
        };

        $scope.drawScoreGraph = function(dataset, targetDiv, callback) {
            return $scope.drawOneVariableGraph(dataset, 'deltaValue', null, targetDiv, callback);
        };

        $scope.drawValuesGraph = function(pair, targetDiv, callback) {
            if (!pair.dataset) return;
            if (!callback) callback = angular.noop;
            var data = new google.visualization.DataTable();
            data.addColumn('date', 'Date');
            data.addColumn('number', pair.stock1);
            data.addColumn('number', pair.stock2);
            data.addRows(pair.dataset.map(function(row) {
                return [new Date(row.date), row.stock1Value, row.stock2Value];
            }));
            var targetEl = angular.element(targetDiv)[0];
            var chart = new google.visualization.LineChart(targetEl);
            google.visualization.events.addOneTimeListener(chart, 'ready', callback);
            chart.draw(data, baseGoogleChartOptions);
            return {chart: chart, data: data};
        };

        $scope.drawGraphWithStd = function(dataset, variableName, option, targetDiv, callback, stdList) {
            if (option == null) option = {};
            if (variableName == null) {
                var rule = PairCalculator[$scope.pairingRule];
                variableName = rule.strategy.dependentVariableName;
            }

            var mean = option.mean || StatHelper.mean(dataset, variableName);
            var std = option.std || StatHelper.std(dataset, variableName);
            // stdList = (stdList || [2, 1, 0, -1, -2]).filter(function(item, pos, self) {
            //     return self.indexOf(item) == pos;
            // });
            option.extraColumns = (stdList || [2, 1, 0, -1, -2]).map(function(stdCount) {
                return {
                    name: _name(stdCount),
                    data: _data(mean, std, stdCount),
                    options: {
                        lineWidth: 1.5,
                        lineDashStyle: [4, 2],
                        enableInteractivity: false,
                        tooltip: 'none'
                    }
                };
            });

            if (option.mean != null) delete option.mean;
            if (option.std != null) delete option.std;

            return $scope.drawOneVariableGraph(dataset, variableName, option, targetDiv, callback);

            function _name(stdCount) {
                if (stdCount === 0) return 'mean';
                var absStdCount = Math.abs(stdCount);
                return 'mean ' + (stdCount > 0? '+' : '-') + absStdCount + ' std';
            }

            function _data(mean, std, stdCount) {
                return dataset.map(function(row, i) {
                    return mean + std * stdCount;
                });
            }
        };

        $scope.drawStrategyGraph = function(strategyResult, variableName, option, targetDiv, callback) {
            var boundsList = strategyResult.result.boundsList;
            var openUpperBounds = [];
            var openLowerBounds = [];
            var closeUpperBounds = [];
            var closeLowerBounds = [];
            var means = [];
            boundsList.forEach(function(bounds) {
                openUpperBounds.push(bounds.open.upper);
                openLowerBounds.push(bounds.open.lower);
                closeUpperBounds.push(bounds.close.upper);
                closeLowerBounds.push(bounds.close.lower);
                means.push(bounds.mean);
            });
            var strategy = strategyResult.strategy;
            var bounds = [
                {name: _name(strategy.open.value), values: openUpperBounds},
                {name: _name(strategy.close.value), values: closeUpperBounds},
                {name: _name(0), values: means},
                {name: _name(-strategy.close.value), values: closeLowerBounds},
                {name: _name(-strategy.open.value), values: openLowerBounds}
            ];

            if (!option) option = {};
            option.extraColumns = bounds.map(function(bound) {
                return {
                    name: bound.name,
                    data: bound.values,
                    options: {
                        lineWidth: 1.5,
                        lineDashStyle: [4, 2],
                        enableInteractivity: false,
                        tooltip: 'none'
                    }
                };
            });

            return $scope.drawOneVariableGraph(
                strategyResult.targetDataset,
                variableName,
                option,
                targetDiv,
                callback
            );

            function _name(stdCount) {
                if (stdCount === 0) return 'mean';
                var absStdCount = Math.abs(stdCount);
                return 'mean ' + (stdCount > 0? '+' : '-') + absStdCount + ' sd';
            }
        };

        var _prepareStrategyDataset = function(stock1, stock2, targetStartDate, targetEndDate, historicalDataset) {
            var startDate = new Date(targetStartDate);
            var endDate = new Date(targetEndDate);
            var historyStartDate = new Date(historicalDataset[0].date);
            var historyEndDate = new Date(historicalDataset[historicalDataset.length - 1].date);
            var dataPromise1 = YQLHelper.getHistoricalDataViaServer(stock1, startDate, endDate);
            var dataPromise2 = YQLHelper.getHistoricalDataViaServer(stock2, startDate, endDate);
            var dividendPromise1 = YQLHelper.getDividendsViaServer(stock1, startDate, endDate);
            var dividendPromise2 = YQLHelper.getDividendsViaServer(stock2, startDate, endDate);
            var historicalDividendPromise1 = YQLHelper.getDividendsViaServer(stock1, historyStartDate, historyEndDate);
            var historicalDividendPromise2 = YQLHelper.getDividendsViaServer(stock2, historyStartDate, historyEndDate);
            return $q.all([
                dataPromise1,
                dataPromise2,
                dividendPromise1,
                dividendPromise2,
                historicalDividendPromise1,
                historicalDividendPromise2
            ]).then(function(responses) {
                var stockData1 = responses[0].data.results;
                var stockData2 = responses[1].data.results;
                var stock1Dividends = responses[2].data.results;
                var stock2Dividends = responses[3].data.results;
                var historicalDividends1 = responses[4].data.results;
                var historicalDividends2 = responses[5].data.results;
                var rule = PairCalculator[$scope.pairingRule];
                var historicalResult = rule.strategy.prepare(historicalDataset);
                var targetDataset =  DatasetPreparator.makeSimpleDataset(stockData1, stockData2);
                DatasetPreparator.makeDividends(historicalDataset, historicalDividends1, historicalDividends2);
                DatasetPreparator.makeDividends(targetDataset, stock1Dividends, stock2Dividends);
                rule.strategy.prepare(
                    targetDataset,
                    historicalResult? historicalResult.regression : null
                );
                console.log(
                    stock1,
                    stock2,
                    (historicalResult? historicalResult.regression.m : ''),
                    (historicalResult? historicalResult.regression.b : '')
                );
                return {
                    stock1: stock1,
                    stock2: stock2,
                    stockData1: stockData1,
                    stockData2: stockData2,
                    stock1Dividends: stock1Dividends,
                    stock2Dividends: stock2Dividends,
                    targetDataset: targetDataset,
                    historicalDataset: historicalDataset
                };
            });
        };

        var _doAllStrategies = function(stock1, stock2, targetStartDate, targetEndDate, historicalDataset) {
            var promise = _prepareStrategyDataset(
                stock1,
                stock2,
                targetStartDate,
                targetEndDate,
                historicalDataset
            ).then(function (params) {
                var rule = PairCalculator[$scope.pairingRule];
                var options = {
                    transactionCost: $scope.transactionCost,
                    useDynamicBounds: $scope.useDynamicBounds,
                    useDynamicDependentVariable: $scope.useDynamicDependentVariable,
                    dependentVariableWeightRules: $scope.dependentVariableWeightRules,
                    boundWeightRules: $scope.boundWeightRules,
                    updateTiming: $scope.updateTiming
                };
                var strategiesResults = StrategyProcessor.doAllStrategies(
                    rule.strategy.processor,
                    params.historicalDataset,
                    params.targetDataset,
                    rule.strategy.dependentVariableName,
                    options
                );
                return {
                    params: params,
                    strategiesResults: strategiesResults
                };
            });
            return promise;
        };

        $scope.targetStartDate = '2014-01-01';
        $scope.targetEndDate = '2015-12-31';
        $scope.doAllStrategy = function() {
            if (!$scope.targetStartDate || !$scope.targetEndDate ||
                $scope.pairDataset) {
                return;
            }
            _doAllStrategies(
                $scope.pair.stock1,
                $scope.pair.stock2,
                $scope.targetStartDate,
                $scope.targetEndDate,
                $scope.pair.dataset
            ).then(function(resolved) {
                var rule = PairCalculator[$scope.pairingRule];
                var params = resolved.params;
                var strategiesResults = resolved.strategiesResults;
                var strategyA1Result = strategiesResults.find(function(strategyResult) {
                    return strategyResult.strategy.id === 'A1';
                });
                $scope.strategiesResults = strategiesResults;
                $scope.strategyGraph = $scope.drawStrategyGraph(
                    strategyA1Result,
                    rule.strategy.dependentVariableName,
                    null,
                    '.targetGraph',
                    function() {
                        if (params.targetDataset[0].deltaValue == null) return;
                        var score = angular.extend({}, $scope.pair, {
                            dataset: params.targetDataset,
                            dayCounts: params.targetDataset.length
                        });
                        $scope.drawValuesGraph(score, '.target-values-graph');
                    }
                );
            });
        };

        var _doStrategiesOnTopPairs = function(pairPool, numOfPair, targetStartDate, targetEndDate) {
            var promises = [];
            var strategyTests = [];
            pairPool.forEach(function(pair, i) {
                if (i >= numOfPair) return false;
                var promise = _doAllStrategies(
                    pair.stock1,
                    pair.stock2,
                    targetStartDate,
                    targetEndDate,
                    pair.dataset
                ).then(function (resolved) {
                    strategyTests.push({
                        top: i,
                        pair: pair,
                        results: resolved.strategiesResults
                    });
                });
                promises.push(promise);
            });
            return $q.all(promises).then(function() {return strategyTests;});
        };

        var _getStrategyProfits = function(strategyTests) {
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
                    if (strategyProfits[i].minProfit == null ||
                        netProfit < strategyProfits[i].minProfit) {
                        strategyProfits[i].minProfit = netProfit;
                    }
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
                $scope.strategySummary.strategyProfits = _getStrategyProfits(strategyTests);
                // -- Getting Score Profit table Data --
                // var _data = [];
                // strategyTests.forEach(function(pair) {
                //     var rowData = [];
                //     rowData.push(pair.pair.stock1);
                //     rowData.push(pair.pair.stock2);
                //     rowData.push(pair.pair.score);
                //     rowData.push(StatHelper.std(pair.results[0].historicalDataset, 'priceRatio'));
                //     pair.results.forEach(function(result) {
                //         rowData.push(result.result.forceClosedProfit || result.result.profit);
                //     });
                //     _data.push(rowData.join(','));
                // });
                // console.log(_data.join('\n'))
                // $window.scoreProfitTableData = ($window.scoreProfitTableData || []).concat(_data);
                // --------------------------------------
            });
        };

        $scope.clickStrategyRow = function(strategyResult) {
            var points = strategyResult.result.actions
                .filter(function(action) {
                    return action.type === 'OPEN' ||
                        action.type === 'CLOSE' ||
                        action.type === 'FORCE_CLOSE' ||
                        action.type === 'STOP_LOSS';
                })
                .map(function(action) {
                    switch (action.type) {
                        case 'OPEN':
                            var color = 'green'; break;
                        case 'STOP_LOSS':
                            var color = 'orange'; break;
                        case 'CLOSE':
                        case 'FORCE_CLOSE':
                            var color = 'red'; break;
                    }
                    return {
                        filter: [{column: 0, value: new Date(action.date)}],
                        style: 'point {shape-type: circle; fill-color: ' + color + ';}'
                    };
                });
            var rule = PairCalculator[$scope.pairingRule];
            $scope.strategyGraph = $scope.drawStrategyGraph(
                strategyResult,
                rule.strategy.dependentVariableName,
                {points: points},
                '.targetGraph'
            );
            var selections = [];
            strategyResult.result.actions.forEach(function(action) {
                var rowIndex = $scope.strategyGraph.data.getFilteredRows([{
                    column: 0,
                    value: new Date(action.date)
                }])[0];
                selections.push({
                    row: rowIndex,
                    column: 6
                });
            });
            $scope.strategyGraph.chart.setSelection(selections);
            $scope.strategyResult = strategyResult;
        };

        $scope.sortStrategiesResultsBy = function(orderBy) {
            var orderExpression;
            switch (orderBy) {
                case "STRATEGY":
                    orderExpression = function(result) {
                        return StrategyList.indexOf(result.strategy);
                    };
                    break;
                case "PROFIT":
                    orderExpression = function(result) {
                        return -result.result.profit;
                    };
                    break;
                case "FORCE_CLOSED_PROFIT":
                    orderExpression = function(result) {
                        return -result.result.forceClosedProfit;
                    };
                    break;
                case "PROFIT_MINUS_TRANSACTION_COST":
                    orderExpression = function(result) {
                        return -(result.result.profit - result.result.transactionCost);
                    };
                    break;
                case "FORCE_CLOSED_PROFIT_MINUS_TRANSACTION_COST":
                    orderExpression = function(result) {
                        return -(result.result.forceClosedProfit - result.result.forceClosedTransactionCost);
                    };
                    break;
            }
            if (!orderExpression) return;
            $scope.strategiesResults = $filter('orderBy')(
                $scope.strategiesResults,
                orderExpression
            );
        };

        $scope.transactionCost = 0.01;
        $scope._transactionCost = '1%';


        $scope.showConfig = function() {
            $scope.configOn = true;
        };

        $scope.startHideConfig = function() {
            $scope.stopHideConfig();
            $scope._hideConfigTimeout = $timeout(function() {
                $scope.configOn = false;
            }, 5000);
        };

        $scope.stopHideConfig = function() {
            if ($scope._hideConfigTimeout && $scope._hideConfigTimeout.cancel) {
                $scope._hideConfigTimeout.cancel();
            }
        };

        $scope.$watch('_transactionCost', function(newVal, oldVal) {
            if (!newVal) return;
            var transactionCost = Number(newVal.replace(/[^0-9]/g, '')) / 100;
            if (isNaN(transactionCost)) return;
            console.log('New Transaction Cost: ' + transactionCost);
            $scope.transactionCost = transactionCost;
        });

        /*=============================================
        =             Row data selection              =
        =============================================*/

        $scope.selectAllRowData = function($event) {
            var checkbox = $event.target;
            $scope.scores.forEach(function(row) {
                row._selected = checkbox.checked;
            });
        };

        $scope.isAllRowDataSelected = function() {
            if (!$scope.scores) return false;
            for (var i = 0; i < $scope.scores.length; i++) {
                if (!$scope.scores[i]._selected) return false;
            }
            return true;
        };

        $scope.isAnyRowDataSelected = function() {
            if (!$scope.scores) return false;
            for (var i = 0; i < $scope.scores.length; i++) {
                if ($scope.scores[i]._selected) return true;
            }
            return false;
        };

        $scope.strategyList = StrategyList;
        $scope.strategyResultOverviewTimeFrame = 'SIMULATION';

        var _updateStrategyResultOverview = function(timeFrame, selectedRows) {
            if (timeFrame === 'HISTORICAL') {
                var startDate = $scope.startDate;
                var endDate = $scope.endDate;
                var resultPropertyName = 'strategiesHistoricalResult';
            } else if (timeFrame === 'SIMULATION') {
                var startDate = $scope.targetStartDate;
                var endDate = $scope.targetEndDate;
                var resultPropertyName = 'strategiesResult';
            }
            $scope.strategyResultOverviewPropertyName = resultPropertyName;
            selectedRows
                .filter(function(row) {return !row[resultPropertyName];})
                .forEach(function(row) {
                    _doAllStrategies(
                        row.stock1,
                        row.stock2,
                        startDate,
                        endDate,
                        row.dataset
                    ).then(function (resolved) {
                        row[resultPropertyName] = resolved.strategiesResults;
                    });
                });
        };

        var _overviewListener = angular.noop;
        $scope.getStrategyResultOverview = function() {
            var selectedRows = $scope.scores.filter(function(row) {
                return row._selected;
            });
            selectedRows.forEach(function(row) {
                delete row.strategiesHistoricalResult;
                delete row.strategiesResult;
            });
            // var timeFrame = $scope.strategyResultOverviewTimeFrame;
            _overviewListener();
            _overviewListener = $scope.$watch(
                'strategyResultOverviewTimeFrame',
                function(newVal) {
                    _updateStrategyResultOverview(newVal, selectedRows);
                }
            );
            $scope.strategyResultOverviewPairs = selectedRows;
            angular.element('.strategy-result-history-modal').modal('show');
        };

        /*=======  End of Row data selection  =======*/


        /*====================================================
        =            Weights Table for Thresholds            =
        ====================================================*/

        $scope.updateTimingChoices = [
            {id: 'EVERYDAY', 'text': 'Update Everyday'},
            {id: 'WHEN_CLOSED', 'text': 'Update When Closed'}
        ];
        $scope.updateTiming = 'EVERYDAY';

        $scope.useDynamicBounds = false;
        $scope.boundWeightRules = [
            {previousDaysCount: 500, weight: 1}
        ];

        $scope.addBoundWeightRule = function() {
            $scope.boundWeightRules.push({});
        };

        var _parseRules = function(rules) {
            rules = rules
                .filter(function(rule) {
                    rule.previousDaysCount = toNumber(rule.previousDaysCount);
                    rule.weight = toNumber(rule.weight);
                    return (
                      (!isNaN(rule.previousDaysCount) || rule.previousDaysCount === '#history') &&
                      (!isNaN(rule.weight) || rule.weight === '#history')
                    );
                })
                .sort(function(rule1, rule2) {
                    if (rule1.previousDaysCount === '#history') return 1;
                    if (rule2.previousDaysCount === '#history') return -1;
                    return rule1.previousDaysCount - rule2.previousDaysCount;
                });
            return rules;

            function toNumber(text) {
                if (/^(#his|#history)$/i.test(text)) return '#history';
                if (/^\s*$/.test(text)) return NaN;
                if (/^\s*(inf|infinity)\s*$/i.test(text)) return Infinity;
                return Number(text);
            }
        };

        $scope.parseBoundWeightRules = function() {
            if (!$scope.useDynamicBounds) return;
            $scope.boundWeightRules = _parseRules($scope.boundWeightRules);
        };

        /*=====  End of Weights Table for Thresholds  ======*/

        /*==================================================================
        =        Weights Table for Dependent Variable Recalibration        =
        ==================================================================*/

        $scope.useDynamicDependentVariable = false;
        $scope.dependentVariableWeightRules = [
            {previousDaysCount: 200, weight: 1.5},
            {previousDaysCount: '#history', weight: 1}
        ];

        $scope.addDependentVariableWeight = function() {
            $scope.dependentVariableWeightRules.push({});
        };

        $scope.parseDependentVariableWeightRules = function() {
            if (!$scope.useDynamicDependentVariable) return;
            $scope.dependentVariableWeightRules = _parseRules(
                $scope.dependentVariableWeightRules
            );
        };

        /*=  End of Weights Table for Dependent Variable Recalibration   =*/


    }]
)