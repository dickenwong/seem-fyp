'use strict';

/* Services */

var dataMiningServices = angular.module('dataMiningServices', []);

dataMiningServices.factory('YQLHelper', ['$http', '$q', '$window',
	function ($http, $q, $window){
		var canceler = $q.defer();
		var doYQL = function(YQL) {
			return $http({
				method: 'GET',
				url: 'https://query.yahooapis.com/v1/public/yql',
				params: {
					format: 'json',
					q: YQL,
					env: 'store://datatables.org/alltableswithkeys',
					diagnostics: true,
					callback: ''
				},
				cache: false,
				responseType: 'json',
				timeout: canceler.promise
			});
		};
		var getHistoricalData = function(stockCode, startDate, endDate) {
			var req = $http({
				method: 'GET',
				url: 'http://real-chart.finance.yahoo.com/table.csv',
				params: {
					s: stockCode, a: startDate.getMonth(), b: startDate.getDate(),
					c: startDate.getFullYear(), d: endDate.getMonth(), e: endDate.getDate(),
					f: endDate.getFullYear(), g: 'd', ignore: '.csv'
				},
				cache: true,
				responseType: 'text/csv',
				timeout: canceler.promise
			});
			return req.then(function success(resp) {
				var config = { delimiter: ',', newline: '\n' };
				resp.data = {
					headersInOrder: $window.Papa.parse(resp.data, angular.extend({preview: 1}, config)).data[0],
					results: $window.Papa.parse(resp.data,angular.extend({header: true}, config)).data
				};
				return resp;
			});
		};
		var getHistoricalDataViaServer = function(stockCode, startDate, endDate) {
			var req = $http({
				method: 'GET',
				url: 'quotes/' + stockCode + '/',
				params: {start: startDate, end: endDate},
				cache: true,
				responseType: 'json',
				timeout: canceler.promise
			});
			return req;
		};
		var getDividendsViaServer = function(stockCode, startDate, endDate) {
			var req = $http({
				method: 'GET',
				url: 'dividends/' + stockCode + '/',
				params: {start: startDate, end: endDate},
				cache: true,
				responseType: 'json',
				timeout: canceler.promise
			});
			return req;
		};
		var cancelAll = function() {
			canceler.resolve();
			canceler = $q.defer();
			return this;
		};
		return {
			doYQL: doYQL,
			cancelAll: cancelAll,
			getHistoricalData: getHistoricalData,
			getHistoricalDataViaServer: getHistoricalDataViaServer,
			getDividendsViaServer: getDividendsViaServer
		};
	}
]);

dataMiningServices.factory('StatHelper', ['$window', function ($window) {

	var _sum = function(stockData, pricePropertyName) {
		if (pricePropertyName == null) pricePropertyName = 'Close';
		return stockData.reduce(function(prev, current) {
			if (current[pricePropertyName] == null) return prev;
			return prev + Number(current[pricePropertyName])
		}, 0);
	};

	var _mean = function(stockData, pricePropertyName) {
		if (pricePropertyName == null) pricePropertyName = 'Close';
		var dayCounts = stockData.filter(function(row) {
			return row[pricePropertyName] != null;
		}).length;
		var sum = _sum(stockData, pricePropertyName);
		return sum / dayCounts;
	};

	var _std = function(stockData, pricePropertyName) {
		if (pricePropertyName == null) pricePropertyName = 'Close';
		var mean = _mean(stockData, pricePropertyName);
		var dayCounts = 0;
		var variance = stockData.reduce(function(prev, current) {
			if (current[pricePropertyName] == null) return prev;
			dayCounts += 1;
			var delta = Number(current[pricePropertyName]) - mean;
			return prev + delta * delta
		}, 0) / (dayCounts - 1);
		return Math.sqrt(variance);
	};

	var _normalize = function(value, mean, std) {
		return (value - mean) / std;
	};

	var _normalizeSeries = function(stockData, pricePropertyName, mean, std) {
		if (pricePropertyName == null) pricePropertyName = 'Close';
		if (mean == null) mean = _mean(stockData, pricePropertyName);
		if (std == null) std = _std(stockData, pricePropertyName);
		return stockData.map(function(row) {
			return _normalize(row[pricePropertyName], mean, std);
		});
	};

	var _weightedMean = function(stockData, pricePropertyName, weights) {
		if (pricePropertyName == null) pricePropertyName = 'Close';
		var weightedSum = stockData.reduce(function(prev, current, i) {
			if (current[pricePropertyName] == null) return prev;
			return prev + Number(current[pricePropertyName]) * weights[i]
		}, 0);
		var totalWeight = weights.reduce(function(prev, current) {
			return prev + current;
		});
		return weightedSum / totalWeight;
	};

	var _weightedStd = function(stockData, pricePropertyName, weights) {
		if (pricePropertyName == null) pricePropertyName = 'Close';
		var weightedMean = _weightedMean(stockData, pricePropertyName, weights);
		var totalWeight = weights.reduce(function(prev, current) {
			return prev + current;
		});
		var weightedVariance = stockData.reduce(function(prev, current, i) {
			if (current[pricePropertyName] == null) return prev;
			var delta = Number(current[pricePropertyName]) - weightedMean;
			return prev + weights[i] * delta * delta
		}, 0) / (totalWeight - 1);
		return Math.sqrt(weightedVariance);
	};

	$window.testStatHelper = {
		sum: _sum,
		mean: _mean,
		std: _std,
		normalize: _normalize,
		normalizeSeries: _normalizeSeries,
		weightedMean: _weightedMean,
		weightedStd: _weightedStd
	};

	return {
		sum: _sum,
		mean: _mean,
		std: _std,
		normalize: _normalize,
		normalizeSeries: _normalizeSeries,
		weightedMean: _weightedMean,
		weightedStd: _weightedStd
	};
}]);

dataMiningServices.factory('PairCalculator', [
	'$q', 'StatHelper', 'DatasetPreparator', '$window',
	'PriceRatioStrategyProcessor', 'CointegrationStrategyProcessor',
	function ($q, StatHelper, DatasetPreparator, $window,
		PriceRatioStrategyProcessor, CointegrationStrategyProcessor) {

		// var byLeastSquare = function(stockData1, stockData2) {
		// 	stockData1 = DatasetPreparator._toDataByDate(stockData1);
		// 	stockData2 = DatasetPreparator._toDataByDate(stockData2);
		// 	var dates = DatasetPreparator._mergeDates(stockData1, stockData2);

		// 	var sumOfSqDelta = 0;
		// 	var dayCounts = 0;
		// 	dates.forEach(function(date) {
		// 		if (!stockData1[date] || !stockData2[date]) return;
		// 		var close1 = +stockData1[date].Close;
		// 		var close2 = +stockData2[date].Close;
		// 		var delta = close1 - close2;
		// 		var sqDelta = delta * delta;
		// 		sumOfSqDelta += sqDelta;
		// 		dayCounts += 1;
		// 	});
		// 	var avgSqDelta = sumOfSqDelta / dayCounts;
		// 	return [avgSqDelta, dayCounts];
		// };

		// var byLeastSquareDeltaPercentChange = function(stockData1, stockData2) {
		// 	stockData1 = DatasetPreparator._toDataByDate(stockData1);
		// 	stockData2 = DatasetPreparator._toDataByDate(stockData2);
		// 	var dates = DatasetPreparator._mergeDates(stockData1, stockData2);
		// 	dates.sort(function(a, b){return new Date(a) - new Date(b);});

		// 	var sumOfSqDelta = 0;
		// 	var dayCounts = 0;
		// 	dates.forEach(function(date, i) {
		// 		var nextDay = dates[i + 1];
		// 		if (!nextDay) return;
		// 		if (!stockData1[date] || !stockData2[date]) return;
		// 		if (!stockData1[nextDay] || !stockData2[nextDay]) return;
		// 		var day1close1 = +stockData1[date].Close;
		// 		var day2close1 = +stockData1[nextDay].Close;
		// 		var day1close2 = +stockData2[date].Close;
		// 		var day2close2 = +stockData2[nextDay].Close;
		// 		var percentChange1 = (day2close1 - day1close1) / day1close1;
		// 		var percentChange2 = (day2close2 - day1close2) / day1close2;
		// 		var delta = percentChange1 - percentChange2;
		// 		var sqDelta = delta * delta;
		// 		sumOfSqDelta += sqDelta;
		// 		dayCounts += 1;
		// 	});
		// 	var avgSqDelta = sumOfSqDelta / dayCounts;
		// 	return [avgSqDelta, dayCounts];
		// };

		var byLeastSquareDeltaOfNormalized = function(stockData1, stockData2, preDefined) {
			var mean1 = preDefined && preDefined.mean1 || StatHelper.mean(stockData1);
			var std1 = preDefined && preDefined.std1 || StatHelper.std(stockData1);
			var mean2 = preDefined && preDefined.mean2 || StatHelper.mean(stockData2);
			var std2 = preDefined && preDefined.std2 || StatHelper.std(stockData2);

			stockData1 = DatasetPreparator._toDataByDate(stockData1);
			stockData2 = DatasetPreparator._toDataByDate(stockData2);
			var dates = DatasetPreparator._mergeDates(stockData1, stockData2);

			var sumOfSqDelta = 0;
			var dayCounts = 0;
			var dataset = [];
			dates.forEach(function(date) {
				if (!stockData1[date] || !stockData2[date]) return;
				var close1 = +stockData1[date].Close;
				var close2 = +stockData2[date].Close;
				var normalized1 = StatHelper.normalize(close1, mean1, std1);
				var normalized2 = StatHelper.normalize(close2, mean2, std2);
				var delta = normalized1 - normalized2;
				var sqDelta = delta * delta;
				sumOfSqDelta += sqDelta;
				dayCounts += 1;
				dataset.push({
					day: dayCounts,
					date: date,
					deltaValue: delta,
					stock1Value: normalized1,
					stock2Value: normalized2,
					stock1Price: close1,
					stock2Price: close2
				});
			});
			var avgSqDelta = sumOfSqDelta / dayCounts;
			return {score: avgSqDelta, dayCounts: dayCounts, dataset: dataset};
		};

		var byCointegration = function(stockData1, stockData2) {
			// y = b + mx + e
			// let x = stock1, y = stock2
			var dataset = DatasetPreparator.makeSimpleDataset(stockData1, stockData2);
			var result = DatasetPreparator.makeLogPriceCointegration(dataset);
			var regressionLine = $window.ss.linearRegressionLine(result.regression);
			var rSquared = $window.ss.rSquared(result.logPrices, regressionLine);
			// console.log(rSquared);
			// var zeroCrossingDayCounts = dataset
			// 	.filter(function(row, i) {
			// 		return i != 0 && dataset[i-1].error * row.error < 0;
			// 	})
			// 	.map(function(row, i, arr) {
			// 		if (i == 0) return;
			// 		return row.day - arr[i-1].day;
			// 	})
			// 	.slice(1)
			// 	.sort(function(a, b) {return a < b? -1 : 1;});

			// var i = zeroCrossingDayCounts.length * 3 / 4;
			// var median2 = i % 1 === 0
			// 	? zeroCrossingDayCounts[i]
			// 	: (zeroCrossingDayCounts[Math.floor(i)] +
			// 		zeroCrossingDayCounts[Math.ceil(i)]) / 2;

			// var zeroCrossingDayCounts = zeroCrossingDayCounts.filter(function(days) {
			// 	return days >= 5;
			// });
			// var i = zeroCrossingDayCounts.length / 2;
			// var median = i % 1 === 0
			// 	? zeroCrossingDayCounts[i]
			// 	: (zeroCrossingDayCounts[Math.floor(i)] +
			// 		zeroCrossingDayCounts[Math.ceil(i)]) / 2;
			// if (rSquared > 0.8) console.log(rSquared, median, median2, zeroCrossingDayCounts.length);
			return {score: -rSquared, dayCounts: dataset.length, dataset: dataset};
		};

		var byCointegrationUpdatingThresholdWhenClose = byCointegration.bind(null);
		var byCointegrationUpdatingThreshold = byCointegration.bind(null);


		byLeastSquareDeltaOfNormalized.strategy = {
			prepare: DatasetPreparator.makeRelativePriceRatio,
			dependentVariableName: 'priceRatio',
			processor: PriceRatioStrategyProcessor
		};

		byCointegration.strategy = {
			prepare: DatasetPreparator.makeLogPriceCointegration,
			dependentVariableName: 'error',
			processor: CointegrationStrategyProcessor.useUpdateBounds()
		};

		byCointegrationUpdatingThresholdWhenClose.strategy = {
			prepare: DatasetPreparator.makeLogPriceCointegration,
			dependentVariableName: 'error',
			processor: CointegrationStrategyProcessor.useUpdateBoundsWhenClose()
		};

		byCointegrationUpdatingThreshold.strategy = {
			prepare: DatasetPreparator.makeLogPriceCointegration,
			dependentVariableName: 'error',
			processor: CointegrationStrategyProcessor.useUpdateBounds()
		};

		return {
			// 'byLeastSquare': byLeastSquare,
			// 'byLeastSquareDeltaPercentChange': byLeastSquareDeltaPercentChange,
			byLeastSquareDeltaOfNormalized: byLeastSquareDeltaOfNormalized,
			byCointegration: byCointegration,
			// byCointegrationUpdatingThresholdWhenClose: byCointegrationUpdatingThresholdWhenClose,
			// byCointegrationUpdatingThreshold: byCointegrationUpdatingThreshold
		};
	}
]);


dataMiningServices.factory('DatasetPreparator',
	['StatHelper', '$window',
	function (StatHelper, $window) {

		var _toDataByDate = function(stockData) {
			var dataByDate = {};
			stockData.forEach(function(record) {
				dataByDate[record.Date] = record;
			});
			return dataByDate;
		};

		var _mergeDates = function(stockDataByMonth1, stockDataByMonth2) {
			var dates1 = Object.keys(stockDataByMonth1);
			var dates2 = Object.keys(stockDataByMonth2);
			var dates = dates1.concat(dates2.filter(function(date) {
				return dates1.indexOf(date) == -1;
			}));
			dates.sort(function(a, b){return new Date(a) - new Date(b);});
			return dates;
		};

		var makeSimpleDataset = function(stockData1, stockData2) {
			stockData1 = _toDataByDate(stockData1);
			stockData2 = _toDataByDate(stockData2);
			var dates = _mergeDates(stockData1, stockData2);
			var dataset = [];
			var dayCounts = 0;
			dates.forEach(function(date) {
				if (!stockData1[date] || !stockData2[date]) return;
				dayCounts += 1;
				dataset.push({
					day: dayCounts,
					date: date,
					stock1Price: +stockData1[date].Close,
					stock2Price: +stockData2[date].Close,
					stock1AdjClose: +stockData1[date]['Adj Close'],
					stock2AdjClose: +stockData2[date]['Adj Close']
				});
			});
			return dataset;
		};

		var makeDividends = function(dataset, stock1Dividends,
				stock2Dividends) {
			stock1Dividends.forEach(addDividend.bind(null, 'stock1Dividend'));
			stock2Dividends.forEach(addDividend.bind(null, 'stock2Dividend'));

			function addDividend(targetVariableName, dividendRow) {
				var row = dataset.find(function(datasetRow) {
					return datasetRow.date === dividendRow.Date ||
						new Date(datasetRow.date) >= new Date(dividendRow.Date);
				});
				if (row) row[targetVariableName] = Number(dividendRow.Dividends);
			}
		};

		var makeRelativePriceRatio = function(dataset) {
			dataset.forEach(function(row) {
				var close1 = row.stock1Price;
				var close2 = row.stock2Price;
				row.priceRatio = close1 / close2;
			});
		};

		var makeLogPriceCointegration = function(dataset, regression, variablePostfix) {
			// y = b + mx + e (let y = stock1, x = stock2)
			if (variablePostfix == null) variablePostfix = '';
			var logPrices = dataset.map(function(row) {
				return [
					Math.log(row.stock2AdjClose),
					Math.log(row.stock1AdjClose)
				];
			});
			if (!regression) regression = $window.ss.linearRegression(logPrices);
			dataset.forEach(function(row, i) {
				row.stock1Value = logPrices[i][1];
				row.stock2Value = regression.m * logPrices[i][0] + regression.b;
				// y - mx - b = e
				row.deltaValue = row.stock1Value - row.stock2Value;
				row['error' + variablePostfix] = row.deltaValue;
				row['cointegrationFactor' + variablePostfix] = regression.m;
			});
			return {logPrices: logPrices, regression: regression};
			// /*----------  Subsection comment block  ----------*/
			// // y = b + mx + e (let x = stock1, y = stock2)
			// var logPrices = dataset.map(function(row) {
			// 	return [
			//		row.stock1Price,
			//		row.stock2Price
			//	];
			// });
			// var regression = ss.linearRegression(logPrices);
			// dataset.forEach(function(row, i) {
			// 	row.stock1Value = regression.m * logPrices[i][0];
			// 	row.stock2Value = logPrices[i][1];
			// 	// y - mx - b = e
			// 	row.deltaValue = row.stock2Value - row.stock1Value - regression.b;
			// 	row.error = row.deltaValue;
			// });
			// return {logPrices: logPrices, regression: regression};
		};

		return {
			_toDataByDate: _toDataByDate,
			_mergeDates: _mergeDates,
			makeSimpleDataset: makeSimpleDataset,
			makeDividends: makeDividends,
			makeRelativePriceRatio: makeRelativePriceRatio,
			makeLogPriceCointegration: makeLogPriceCointegration
		};
	}]
);


dataMiningServices.factory('StrategyProcessor',
	['PairCalculator', 'StatHelper', 'StrategyList',
	function (PairCalculator, StatHelper, StrategyList) {

		var _getUptoDateDataset = function(currentRow, historicalDataset,
				targetDataset) {
			var dataset = targetDataset.filter(function(row) {
				return row.day <= currentRow.day
			});
			dataset = historicalDataset.concat(dataset);
			return dataset;
		};

		var _getWeights = function(rules, upToDateDataset, historicalDataset) {
			var weightFunc = function(row, i, dataset) {
				var rule = rules.find(function(rule) {
					var prevDayCount = rule.previousDaysCount === '#history'
						? historicalDataset.length
						: rule.previousDaysCount;
					return dataset.length - i <= prevDayCount;
				});
				return rule? rule.weight : 0;
			};
			return upToDateDataset.map(weightFunc);
		};

		var doStrategy = function(strategyProcessor, strategy, historicalDataset,
				targetDataset, valuePropertyName, options) {
			if (!options) options = {};
			/*===========================
			=            DEV            =
			===========================*/
			options.stopLoss = {unit: 'STD', value: 4};
			options.forceClose = false;
			// options.dependentVariableWeightRules = [
			// 	{previousDaysCount: '#history', weight: 1}
			// ];
			// options.updateDataset = 'EVERY_DAY';
			/*=====  End of DEV  ======*/

			var stopLoss = options.stopLoss;
			var useDynamicBounds = options.useDynamicBounds;
			var useDynamicDependentVariable = options.useDynamicDependentVariable;
			var updateTiming = options.updateTiming;

			var boundWeightRules = options.boundWeightRules;
			var dependentVariableWeightRules = options.dependentVariableWeightRules;

			if (updateTiming && useDynamicDependentVariable) {
				var originalValuePropertyName = valuePropertyName;
				var latestNamePostFix = 'Latest';
				valuePropertyName += latestNamePostFix;
			}

			var lastOpen = null;
			var boundsList = [];
			var actions = [];

			targetDataset.forEach(function(row, i) {
				var upToDateDataset = _getUptoDateDataset(
					row,
					historicalDataset,
					targetDataset
				);
				var needUpdate = (
					updateTiming === 'EVERYDAY' ||
					updateTiming === 'WHEN_CLOSED' && !lastOpen
				);

				// Update Dataset If needed
				if (needUpdate && useDynamicDependentVariable) {
					var dependentVariableWeights = _getWeights(
						dependentVariableWeightRules,
						upToDateDataset,
						historicalDataset
					);
					strategyProcessor.updateDataset(
						row,
						upToDateDataset,
						dependentVariableWeights,
						latestNamePostFix
					)
				}

				// Find Tradinig Thresholds
				if ((needUpdate && useDynamicBounds) || !boundsList[i-1]) {
					var boundWeights = _getWeights(
						boundWeightRules,
						upToDateDataset,
						historicalDataset
					);
					var bounds = boundsList[i] = strategyProcessor.getBounds(
						boundsList[i-1], strategy, lastOpen, upToDateDataset,
						historicalDataset, targetDataset, valuePropertyName,
						boundWeights
					);
				} else {
					var bounds = boundsList[i] = boundsList[i-1];
				}

				var value = row[valuePropertyName];

				if (!stopLoss) {
					var stopLossBounds = {upper: Infinity, lower: -Infinity};
				} else if (stopLoss.unit === 'OPEN_POSITION') {
					var stopLossBounds = {
						upper: bounds.open.upper +
							Math.abs(bounds.open.upper - bounds.mean) * stopLoss.value,
						lower: bounds.open.lower -
							Math.abs(bounds.open.lower - bounds.mean) * stopLoss.value
					};
				} else if (stopLoss.unit === 'STD') {
					// var lastAction = actions[actions.length - 1];
					// if (lastAction && lastAction.type === 'STOP_LOSS') {
					// 	var stopLossBounds = {
					// 		upper: bounds.mean + bounds.std * (stopLoss.value - 1),
					// 		lower: bounds.mean - bounds.std * (stopLoss.value - 1)
					// 	};
					// } else {
						var stopLossBounds = {
							upper: bounds.mean + bounds.std * stopLoss.value,
							lower: bounds.mean - bounds.std * stopLoss.value
						};
					// }
				}

				if (!lastOpen) {
					var exceedUpperOpenBound = value >= bounds.open.upper;
					var exceedLowerOpenBound = value <= bounds.open.lower;
					var insideStopLossBounds = (
						value <= stopLossBounds.upper &&
						value >= stopLossBounds.lower
					);
					if ((exceedUpperOpenBound || exceedLowerOpenBound)
							&& insideStopLossBounds) {
						lastOpen = {
							type: 'OPEN',
							stock1Action: exceedUpperOpenBound? 'SHORT' : 'LONG',
							stock2Action: exceedUpperOpenBound? 'LONG' : 'SHORT'
						};
						actions.push(angular.extend({}, row, lastOpen));
					}
				} else {
					if (row.stock1Dividend || row.stock2Dividend) {
						// Deprecated due to using adjusted close price
						// actions.push(angular.extend({}, row, {type: 'DIVIDEND'}));
					}
					var reachCloseBound = (
						lastOpen.stock1Action == 'SHORT' && value <= bounds.close.upper ||
						lastOpen.stock1Action == 'LONG' && value >= bounds.close.lower
					);
					var exceedStopLossBound = (
						lastOpen.stock1Action == 'SHORT' && value >= stopLossBounds.upper ||
						lastOpen.stock1Action == 'LONG' && value <= stopLossBounds.lower
					);

					if (reachCloseBound) {
						actions.push(angular.extend({}, row, {type: 'CLOSE'}));
						lastOpen = null;

					} else if (exceedStopLossBound) {
						var exceedStopLossBound = (
							lastOpen.stock1Action == 'SHORT' && value >= stopLossBounds.upper ||
							lastOpen.stock1Action == 'LONG' && value <= stopLossBounds.lower
						);
						if (exceedStopLossBound) {
							actions.push(angular.extend({}, row, {type: 'STOP_LOSS'}));
							lastOpen = null;
						}

					} else if (options.forceClose && i == targetDataset.length - 1) {
						actions.push(angular.extend({}, row, {type: 'FORCE_CLOSE'}));
					}

				}

			});

			var calculationResult = calculateProfit(
				strategyProcessor,
				strategy,
				actions,
				targetDataset,
				valuePropertyName,
				options
			);
			calculationResult.boundsList = boundsList;

			return calculationResult;
		};


		var calculateProfit = function(strategyProcessor, strategy, actions,
				targetDataset, valuePropertyName, options) {
			// t stands for Transaction in this function
			var openCounts = 0;
			var closeCounts = 0;
			var profit = 0;
			var transactionCost = 0;
			var holdingDuration = 0;
			var dividendProfit = 0;
			var profitPercent = 0;

			var forceClosedCounts = 0;
			var forceClosedProfit = 0;
			var forceClosedTransactionCost = 0;
			var forceClosedHoldingDuration = 0;
			var forceClosedProfitPercent = 0;

			var lastOpen = null;
			var dividendProfitSinceLastOpen = 0;
			var tStrategy = strategy.transaction;
			var tCostPercent = (options && options.transactionCost) || 0;

			actions.forEach(function(action, i) {
				var tValue = tStrategy.value + profit * (+tStrategy.accumalated);
				if (action.type === 'OPEN') {
					openCounts += 1;
					lastOpen = action;
					angular.extend(action, strategyProcessor.getStockShares(tValue, action));
					action.transactionCost = _getTransactionCost(tCostPercent, action);
					transactionCost += action.transactionCost;

				} else if (action.type === 'DIVIDEND') {
					action.profit = _getDividend(lastOpen, action);
					dividendProfitSinceLastOpen += action.profit;
					dividendProfit += action.profit;

				} else if (action.type === 'CLOSE' || action.type === 'FORCE_CLOSE' ||
						action.type === 'STOP_LOSS') {
					var thisHoldingDuration = action.day - lastOpen.day;
					var thisProfit = _getProfit(lastOpen, action);
					var thisTransactionCost = _getTransactionCost(
						tCostPercent,
						lastOpen,
						action
					);
					var thisProfitPercent = _getProfitPercent(
						tCostPercent,
						dividendProfitSinceLastOpen,
						lastOpen,
						action
					);

					action.lastOpen = lastOpen;
					if (action.type === 'CLOSE'|| action.type === 'STOP_LOSS') {
						closeCounts += 1;
						holdingDuration += thisHoldingDuration;
						action.profit = thisProfit;
						action.transactionCost = thisTransactionCost;
						// ----- Profit Percent ----- //
						action.profitPercent = thisProfitPercent;
						// ----- Profit Percent ----- //
						profit += thisProfit;
						transactionCost += thisTransactionCost;
						profitPercent += thisProfitPercent;
						lastOpen = null;
						dividendProfitSinceLastOpen = 0;

					} else if (action.type === 'FORCE_CLOSE') {
						forceClosedCounts += 1;
						forceClosedHoldingDuration += thisHoldingDuration;
						action.forceClosedProfit = thisProfit;
						action.forceClosedTransactionCost = thisTransactionCost;
						// ----- Profit Percent ----- //
						action.forceClosedProfitPercent = thisProfitPercent;
						// ----- Profit Percent ----- //
						forceClosedProfit += thisProfit;
						forceClosedTransactionCost += thisTransactionCost;
						forceClosedProfitPercent += thisProfitPercent;
					}
				}
			});

			profit += dividendProfit;
			forceClosedCounts += closeCounts;
			forceClosedProfit += profit;
			forceClosedTransactionCost += transactionCost;
			forceClosedHoldingDuration += holdingDuration;
			forceClosedProfitPercent += profitPercent;

			var result = {
				openCounts: openCounts,
				closeCounts: closeCounts,
				isHolding: !!lastOpen,
				profit: profit,
				transactionCost: transactionCost,
				holdingDuration: holdingDuration,
				profitPerHoldingDay: profit / holdingDuration,
				dividendProfit: dividendProfit,

				forceClosedCounts: forceClosedCounts,
				forceClosedProfit: forceClosedProfit,
				forceClosedTransactionCost: forceClosedTransactionCost,
				forceClosedHoldingDuration: forceClosedHoldingDuration,
				forceClosedProfitPerHoldingDay: forceClosedProfit / forceClosedHoldingDuration,

				profitPercent: profitPercent,
				forceClosedProfitPercent: forceClosedProfitPercent,

				actions: actions,
				options: options
			};

			if (strategyProcessor.formatResult) strategyProcessor.formatResult(result);

			return result;
		};

		var doAllStrategies = function(strategyProcessor, historicalDataset,
				targetDataset, valuePropertyName, options) {
			return StrategyList.map(function(strategy) {
				return {
					historicalDataset: historicalDataset,
					targetDataset: targetDataset,
					strategy: strategy,
					result: doStrategy(
						strategyProcessor,
						strategy,
						historicalDataset,
						targetDataset,
						valuePropertyName,
						options
					)
				}
			});
		};

		var _getProfit = function(openAction, closeAction) {
			var isLongingStock1 = openAction.stock1Action === 'LONG';
			var isLongingStock2 = openAction.stock2Action === 'LONG';
			var openProfit = (
				openAction.stock1AdjClose * openAction.stock1Share * (isLongingStock1? -1 : 1) +
				openAction.stock2AdjClose * openAction.stock2Share * (isLongingStock2? -1 : 1)
			);
			var closeProfit = (
				closeAction.stock1AdjClose * openAction.stock1Share * (isLongingStock1? 1 : -1) +
				closeAction.stock2AdjClose * openAction.stock2Share * (isLongingStock2? 1 : -1)
			);
			return closeProfit + openProfit;
		};

		var _getTransactionCost = function(tCostPercent, openAction, closeAction) {
			if (!closeAction) closeAction = openAction;
			var stock1Cost = openAction.stock1Share * closeAction.stock1AdjClose * tCostPercent;
			var stock2Cost = openAction.stock2Share * closeAction.stock2AdjClose * tCostPercent;
			return stock1Cost + stock2Cost;
		};

		var _getDividend = function(openAction, dividendAction) {
			var stock1Dividend = (dividendAction.stock1Dividend || 0) * openAction.stock1Share;
			var stock2Dividend = (dividendAction.stock2Dividend || 0) * openAction.stock2Share;
			var totalDividend = (
				stock1Dividend * (openAction.stock1Action === 'LONG'? 1 : -1) +
				stock2Dividend * (openAction.stock2Action === 'LONG'? 1 : -1)
			);
			return totalDividend;
		};

		var _getProfitPercent = function(tCostPercent, dividendProfitSinceLastOpen,
				openAction, closeAction) {
			var isLongingStock1 = openAction.stock1Action === 'LONG';
			var isLongingStock2 = openAction.stock2Action === 'LONG';
			if (openAction.stock1Share < 0) isLongingStock1 = isLongingStock1? false : true;
			if (openAction.stock2Share < 0) isLongingStock2 = isLongingStock2? false : true;
			if (isLongingStock1 === isLongingStock2) console.log('This pair has same Action');

			var stock1OpenAbsProfit = Math.abs(openAction.stock1AdjClose * openAction.stock1Share);
			var stock2OpenAbsProfit = Math.abs(openAction.stock2AdjClose * openAction.stock2Share);
			var stock1CloseAbsProfit = Math.abs(closeAction.stock1AdjClose * openAction.stock1Share);
			var stock2CloseAbsProfit = Math.abs(closeAction.stock2AdjClose * openAction.stock2Share);

			var longCost = (
				(isLongingStock1? stock1OpenAbsProfit : stock1CloseAbsProfit) +
				(isLongingStock2? stock2OpenAbsProfit : stock2CloseAbsProfit)
			);
			var shortProfit = (
				(isLongingStock1? stock1CloseAbsProfit : stock1OpenAbsProfit) +
				(isLongingStock2? stock2CloseAbsProfit : stock2OpenAbsProfit)
			);
			var transactionCosts = (shortProfit + longCost) * tCostPercent;
			return (shortProfit + dividendProfitSinceLastOpen - longCost - transactionCosts ) / longCost;
		};


		return {
			doStrategy: doStrategy,
			doAllStrategies: doAllStrategies
		};
	}]
);


dataMiningServices.factory('PriceRatioStrategyProcessor', [
	'StatHelper',
	function(StatHelper) {

		var getStockShares = function(tValue, openAction) {
			var stock1ShareWeight = 1 / openAction.stock1Price;
			var stock2ShareWeight = 1 / openAction.stock2Price;
			return {
				stock1Share: tValue * stock1ShareWeight,
				stock2Share: tValue * stock2ShareWeight
			};
		};

		var getBounds = function(lastBounds, strategy, currentRow, lastOpenAction,
				historicalDataset, targetDataset, valuePropertyName) {
			if (lastBounds) return lastBounds;
			var std = StatHelper.std(historicalDataset, valuePropertyName);
			var mean = StatHelper.mean(historicalDataset, valuePropertyName);
			var bounds = {
				open: {
					upper: mean + strategy.open.value * std,
					lower: mean - strategy.open.value * std
				},
				close: {
					upper: mean + strategy.close.value * std,
					lower: mean - strategy.close.value * std
				},
				mean: mean,
				std: std
			};
			return bounds;
		};


		return {
			getStockShares: getStockShares,
			getBounds: getBounds,
			updateDataset: angular.noop
		};
	}
]);


dataMiningServices.factory('CointegrationStrategyProcessor', [
	'StatHelper', '$window', 'DatasetPreparator',
	function(StatHelper, $window, DatasetPreparator) {

		var getStockShares = function(tValue, openAction) {
			return {
				stock1Share: tValue,
				stock2Share: tValue * openAction.cointegrationFactor
			};
		};

		var formatResult = function(result) {
			result.actions.forEach(function(action) {
				if (action.cointegrationFactor > 0) return;
				if (action.stock2Share) action.stock2Share = Math.abs(action.stock2Share);
				if (action.stock2Action === 'LONG') action.stock2Action = 'SHORT';
				else if (action.stock2Action === 'SHORT') action.stock2Action = 'LONG';
			});
		};

		var getBounds = function(lastBounds, strategy, lastOpenAction,
				upToDateDataset, historicalDataset, targetDataset,
				valuePropertyName, weights) {
			if (weights) {
				var std = StatHelper.weightedStd(upToDateDataset, valuePropertyName, weights);
				var mean = StatHelper.weightedMean(upToDateDataset, valuePropertyName, weights);
			} else {
				var std = StatHelper.std(upToDateDataset, valuePropertyName);
				var mean = StatHelper.mean(upToDateDataset, valuePropertyName);
			}
			var bounds = {
				open: {
					upper: mean + strategy.open.value * std,
					lower: mean - strategy.open.value * std
				},
				close: {
					upper: mean + strategy.close.value * std,
					lower: mean - strategy.close.value * std
				},
				mean: mean,
				std: std
			};
			return bounds;
		};

		var updateDataset = function(currentRow, upToDateDataset, weights,
				latestNamePostFix) {
			var logPrices = upToDateDataset.map(function(row) {
				return [
					Math.log(row.stock2AdjClose),
					Math.log(row.stock1AdjClose)
				];
			});
			var regression = weights
				? $window.ss.weightedLinearRegession(logPrices, weights)
				: $window.ss.linearRegression(logPrices);
			// var rSquared = weights
			// 	?

			DatasetPreparator.makeLogPriceCointegration(
				upToDateDataset,
				regression,
				latestNamePostFix
			);
			currentRow.error = currentRow['error' + latestNamePostFix];
			currentRow.cointegrationFactor = currentRow['cointegrationFactor' + latestNamePostFix];
		};

		var useUpdateBoundsWhenClose = function() {
			var _getBounds = getBounds;
			return angular.extend({}, this, {
				getBounds: function(lastBounds, strategy, lastOpenAction) {
					if (lastOpenAction) return lastBounds;
					return _getBounds.apply(this, arguments);
				}
			});
		};

		var useUpdateBounds = function() {
			return angular.extend({}, this)
		};

		var useNoUpdateBounds = function() {
			var _getBounds = getBounds;
			return angular.extend({}, this, {
				getBounds: function(lastBounds, strategy, lastOpenAction,
						upToDateDataset, historicalDataset, targetDataset,
						valuePropertyName, weights) {
					if (lastBounds) return lastBounds;
					return _getBounds.call(this, lastBounds, strategy, lastOpenAction,
						historicalDataset, historicalDataset, [],
						valuePropertyName, weights);
				}
			});
		};


		return {
			getStockShares: getStockShares,
			formatResult: formatResult,
			getBounds: getBounds,
			updateDataset: updateDataset,

			useUpdateBoundsWhenClose: useUpdateBoundsWhenClose,
			useUpdateBounds: useUpdateBounds,
			useNoUpdateBounds: useNoUpdateBounds
		};
	}
]);



dataMiningServices.factory('PairCrawler',
	['$q', 'YQLHelper', '$window', 'PairCalculator',
	function ($q, YQLHelper, $window, PairCalculator) {

		var _stockPool = [];
		var importStockPool = function(csvString) {
			var result = $window.Papa.parse(csvString, {delimiter: ","});
			result = result.data.reduce(function(prev, current) {
				return prev.concat(current);
			}, []).map(function(item) {
				if (item.trim()) return item.trim();
			}).filter(function(item, pos, self) {
				return self.indexOf(item) == pos;
			});
			_stockPool = result;
			return _stockPool;
		};
		var crawl = function(ruleFuncName, startDate, endDate) {
			var pool = _stockPool;
			var getPromises = [];
			var dataset = [];
			pool.forEach(function(stock, i) {
				var promise = YQLHelper.getHistoricalDataViaServer(
                    stock, startDate, endDate
                );
				getPromises.push(promise);
			});
			return $q.all(getPromises).then(function(dataset) {
				var scores = [];
				dataset = dataset.map(function(resp) {
					return resp.data.results;
				});
				pool.forEach(function(stock1, i) {
					pool.forEach(function(stock2, j) {
						if (j <= i) return;
						var result = PairCalculator[ruleFuncName](dataset[i], dataset[j]);
						scores.push({
							stock1: stock1,
							stock2: stock2,
							score: result.score,
							dayCounts: result.dayCounts,
							dataset: result.dataset,
						});
					});
				});
				return scores;
			});
		};
		return {
			'importStockPool': importStockPool,
			'crawl': crawl
		};
	}]
);

dataMiningServices.value('StockCategories', [
	{
		name: 'Banking',
		stocks: '0005.HK, 0011.HK, 0023.HK, 0440.HK, 0626.HK, 0939.HK, 0998.HK, 1111.HK, 1288.HK, 1398.HK, 1963.HK, 1988.HK, 2066.HK, 2356.HK, 2388.HK, 2888.HK, 3328.HK, 3618.HK, 3698.HK, 3968.HK, 3988.HK, 4605.HK, 6138.HK, 6818.HK'
	},
	{
		name: 'Insurance',
		stocks: '0662.HK, 0945.HK, 0966.HK, 1299.HK, 1336.HK, 1339.HK, 1508.HK, 2318.HK, 2328.HK, 2378.HK, 2601.HK, 2628.HK, 6161.HK',
	},
	{
		name: 'Properties',
		stocks: '0012.HK, 0016.HK, 0017.HK, 0020.HK, 0021.HK, 0028.HK, 0034.HK, 0035.HK, 0041.HK, 0050.HK, 0051.HK, 0059.HK, 0063.HK, 0081.HK, 0088.HK, 0095.HK, 0112.HK, 0115.HK, 0119.HK, 0123.HK, 0124.HK, 0127.HK, 0129.HK, 0160.HK, 0163.HK, 0169.HK, 0173.HK, 0183.HK, 0190.HK, 0199.HK'
	},
	{
		name: 'Investments & Assets Management',
		stocks: '0053.HK, 0068.HK, 0080.HK, 0120.HK, 0133.HK, 0165.HK, 0174.HK, 0204.HK, 0273.HK, 0286.HK, 0310.HK, 0339.HK, 0356.HK, 0372.HK, 0378.HK, 0383.HK, 0412.HK, 0428.HK, 0430.HK, 0508.HK, 0575.HK, 0612.HK, 0613.HK, 0619.HK, 0666.HK, 0721.HK, 0768.HK, 0770.HK, 0806.HK, 0810.HK'
	},
	{
		name: 'E-Commerce & Internet Services',
		stocks: '0250.HK, 0327.HK, 0395.HK, 0400.HK, 0434.HK, 0484.HK, 0536.HK, 0543.HK, 0673.HK, 0700.HK, 0777.HK, 0799.HK, 1022.HK, 1026.HK, 1094.HK, 1980.HK, 2100.HK, 2280.HK, 6899.HK, 8007.HK, 8026.HK, 8081.HK, 8121.HK, 8206.HK, 8255.HK, 8266.HK, 8267.HK, 8317.HK, 8361.HK, 8400.HK'
	},
	{
		name: 'Petroleum & Gases',
		stocks: '0007.HK, 0091.HK, 0135.HK, 0166.HK, 0171.HK, 0228.HK, 0260.HK, 0332.HK, 0338.HK, 0342.HK, 0346.HK, 0353.HK, 0386.HK, 0467.HK, 0689.HK, 0702.HK, 0850.HK, 0852.HK, 0857.HK, 0883.HK, 0933.HK, 0934.HK, 1102.HK, 1103.HK, 1192.HK, 1205.HK, 1555.HK, 2012.HK, 2386.HK, 2686.HK'
	},
	{
		name: 'ETF',
		stocks: '2800.HK, 2822.HK, 2828.HK, 2823.HK, 3188.HK, 3081.HK, 2840.HK, 3147.HK, 0700.HK, 0005.HK, 0941.HK, 1299.HK, 0939.HK, 1398.HK, 0001.HK, 3988.HK, 0388.HK, 2318.HK, 0883.HK, 0002.HK'
	},
	{
		name: 'Dev Testing',
		stocks: '0001.HK, 2800.HK, 2833.HK'
	}
]);

dataMiningServices.value('StrategyList', [
	// {
	//     "id": "A3",
	//     "name": "Open at 2 sd, close at 1.5 sd",
	//     "open": { "unit": "std", "value": 2 },
	//     "close": { "unit": "std", "value": 1.5 },
	//     "transaction": { "value": 1, "accumalated": false }
	// },
	{
	    "id": "A2",
	    "name": "Open at 2 sd, close at 1 sd",
	    "open": { "unit": "std", "value": 2 },
	    "close": { "unit": "std", "value": 1 },
	    "transaction": { "value": 1, "accumalated": false }
	},
	{
	    "id": "A1",
	    "name": "Open at 2 sd, close at 0.5 sd",
	    "open": { "unit": "std", "value": 2 },
	    "close": { "unit": "std", "value": 0.5 },
	    "transaction": { "value": 1, "accumalated": false }
	},
	{
	    "id": "A0",
	    "name": "Open at 2 sd, close at 0 sd",
	    "open": { "unit": "std", "value": 2 },
	    "close": { "unit": "std", "value": 0 },
	    "transaction": { "value": 1, "accumalated": false }
	},
	// {
	//     "id": "B2",
	//     "name": "Open at 1.5 sd, close at 1 sd",
	//     "open": { "unit": "std", "value": 1.5 },
	//     "close": { "unit": "std", "value": 1 },
	//     "transaction": { "value": 1, "accumalated": false }
	// },
	{
	    "id": "B1",
	    "name": "Open at 1.5 sd, close at 0.5 sd",
	    "open": { "unit": "std", "value": 1.5 },
	    "close": { "unit": "std", "value": 0.5 },
	    "transaction": { "value": 1, "accumalated": false }
	},
	{
	    "id": "B0",
	    "name": "Open at 1.5 sd, close at 0 sd",
	    "open": { "unit": "std", "value": 1.5 },
	    "close": { "unit": "std", "value": 0 },
	    "transaction": { "value": 1, "accumalated": false }
	},
	// {
	//     "id": "C1",
	//     "name": "Open at 1 sd, close at 0.5 sd",
	//     "open": { "unit": "std", "value": 1 },
	//     "close": { "unit": "std", "value": 0.5 },
	//     "transaction": { "value": 1, "accumalated": false }
	// },
	{
	    "id": "C0",
	    "name": "Open at 1 sd, close at 0 sd",
	    "open": { "unit": "std", "value": 1 },
	    "close": { "unit": "std", "value": 0 },
	    "transaction": { "value": 1, "accumalated": false }
	},
	// {
	//     "id": "D0",
	//     "name": "Open at 0.5 sd, close at 0 sd",
	//     "open": { "unit": "std", "value": 0.5 },
	//     "close": { "unit": "std", "value": 0 },
	//     "transaction": { "value": 1, "accumalated": false }
	// },
	// {
	//     "id": "E0",
	//     "name": "Open at 0.7 sd, close at 0 sd",
	//     "open": { "unit": "std", "value": 0.7 },
	//     "close": { "unit": "std", "value": 0 },
	//     "transaction": { "value": 1, "accumalated": false }
	// },
]);