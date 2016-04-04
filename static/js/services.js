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
			var zeroCrossingDayCounts = dataset
				.filter(function(row, i) {
					return i != 0 && dataset[i-1].error * row.error < 0;
				})
				.map(function(row, i, arr) {
					if (i == 0) return;
					return row.day - arr[i-1].day;
				})
				.slice(1)
				.sort(function(a, b) {return a < b? -1 : 1;});

			var i = zeroCrossingDayCounts.length * 3 / 4;
			var median2 = i % 1 === 0
				? zeroCrossingDayCounts[i]
				: (zeroCrossingDayCounts[Math.floor(i)] +
					zeroCrossingDayCounts[Math.ceil(i)]) / 2;

			var zeroCrossingDayCounts = zeroCrossingDayCounts.filter(function(days) {
				return days >= 5;
			});
			var i = zeroCrossingDayCounts.length / 2;
			var median = i % 1 === 0
				? zeroCrossingDayCounts[i]
				: (zeroCrossingDayCounts[Math.floor(i)] +
					zeroCrossingDayCounts[Math.ceil(i)]) / 2;
			// if (rSquared > 0.8) console.log(rSquared, median, median2, zeroCrossingDayCounts.length);
			return {score: -rSquared, dayCounts: dataset.length, dataset: dataset};
		};

		var byCointegrationUpdatingMeanAndSdWhenClose = byCointegration.bind(null);
		var byCointegrationUpdatingMeanAndSd = byCointegration.bind(null);


		byLeastSquareDeltaOfNormalized.strategy = {
			prepare: DatasetPreparator.makeRelativePriceRatio,
			dependentVariableName: 'priceRatio',
			processor: PriceRatioStrategyProcessor
		};

		byCointegration.strategy = {
			prepare: DatasetPreparator.makeLogPriceCointegration,
			dependentVariableName: 'error',
			processor: CointegrationStrategyProcessor.useNoUpdateBounds()
		};

		byCointegrationUpdatingMeanAndSdWhenClose.strategy = {
			prepare: DatasetPreparator.makeLogPriceCointegration,
			dependentVariableName: 'error',
			processor: CointegrationStrategyProcessor.useUpdateBoundsWhenClose()
		};

		byCointegrationUpdatingMeanAndSd.strategy = {
			prepare: DatasetPreparator.makeLogPriceCointegration,
			dependentVariableName: 'error',
			processor: CointegrationStrategyProcessor.useUpdateBoundsNonStop()
		};

		return {
			// 'byLeastSquare': byLeastSquare,
			// 'byLeastSquareDeltaPercentChange': byLeastSquareDeltaPercentChange,
			'byLeastSquareDeltaOfNormalized': byLeastSquareDeltaOfNormalized,
			'byCointegration': byCointegration,
			byCointegrationUpdatingMeanAndSdWhenClose: byCointegrationUpdatingMeanAndSdWhenClose,
			byCointegrationUpdatingMeanAndSd: byCointegrationUpdatingMeanAndSd
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
					stock2Price: +stockData2[date].Close
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

		var makeLogPriceCointegration = function(dataset, regression) {
			// y = b + mx + e (let y = stock1, x = stock2)
			var logPrices = dataset.map(function(row) {
				return [Math.log(row.stock2Price), Math.log(row.stock1Price)];
			});
			if (!regression) regression = $window.ss.linearRegression(logPrices);
			dataset.forEach(function(row, i) {
				row.stock1Value = logPrices[i][1];
				row.stock2Value = regression.m * logPrices[i][0] + regression.b;
				// y - mx - b = e
				row.deltaValue = row.stock1Value - row.stock2Value;
				row.error = row.deltaValue;
				row.cointegrationFactor = regression.m;
			});
			return {logPrices: logPrices, regression: regression};
			// /*----------  Subsection comment block  ----------*/
			// // y = b + mx + e (let x = stock1, y = stock2)
			// var logPrices = dataset.map(function(row) {
			// 	return [Math.log(row.stock1Price), Math.log(row.stock2Price)];
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

		var doStrategy = function(strategyProcessor, strategy, historicDataset,
				targetDataset, valuePropertyName, options) {
			var lastOpen = null;
			var boundsList = [];
			var actions = [];
			targetDataset.forEach(function(row, i) {
				var value = row[valuePropertyName];
				var bounds = boundsList[i] = strategyProcessor.getBounds(
					boundsList[i-1], strategy, row, lastOpen, historicDataset,
					targetDataset, valuePropertyName
				);

				if (!lastOpen) {
					var exceedUpperOpenBound = value >= bounds.open.upper;
					var exceedLowerOpenBound = value <= bounds.open.lower;
					if (exceedUpperOpenBound || exceedLowerOpenBound) {
						lastOpen = {
							type: 'OPEN',
							stock1Action: exceedUpperOpenBound? 'SHORT' : 'LONG',
							stock2Action: exceedUpperOpenBound? 'LONG' : 'SHORT'
						};
						actions.push(angular.extend({}, row, lastOpen));
					}
				} else {
					if (row.stock1Dividend || row.stock2Dividend) {
						actions.push(angular.extend({}, row, {type: 'DIVIDEND'}));
					}
					if (value <= bounds.close.upper && lastOpen.stock1Action == 'SHORT' ||
						value >= bounds.close.lower && lastOpen.stock1Action == 'LONG') {
						actions.push(angular.extend({}, row, {type: 'CLOSE'}));
						lastOpen = null;
					} else if (i == targetDataset.length - 1) {
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

			var forceClosedCounts = 0;
			var forceClosedProfit = 0;
			var forceClosedTransactionCost = 0;
			var forceClosedHoldingDuration = 0;

			var lastOpen = null;
			var tStrategy = strategy.transaction;
			var tCostPercent = (options && options.transactionCost) || 0;

			actions.forEach(function(action, i) {
				var tValue = tStrategy.value + profit * (+tStrategy.accumalated);
				if (action.type == 'OPEN') {
					openCounts += 1;
					lastOpen = action;
					angular.extend(action, strategyProcessor.getStockShares(tValue, action));
					action.transactionCost = _getTransactionCost(tCostPercent, action);
					transactionCost += action.transactionCost;

				} else if (action.type == 'DIVIDEND') {
					action.profit = _getDividend(lastOpen, action);
					profit += action.profit;
					dividendProfit += action.profit;

				} else if (action.type == 'CLOSE' || action.type == 'FORCE_CLOSE') {
					var thisHoldingDuration = action.day - lastOpen.day;
					var thisProfit = _getProfit(lastOpen, action);
					var thisTransactionCost = _getTransactionCost(
						tCostPercent,
						lastOpen,
						action
					);
					action.lastOpen = lastOpen;
					if (action.type === 'CLOSE') {
						closeCounts += 1;
						holdingDuration += thisHoldingDuration;
						action.profit = thisProfit;
						action.transactionCost = thisTransactionCost;
						profit += thisProfit;
						transactionCost += thisTransactionCost;
						lastOpen = null;

					} else if (action.type === 'FORCE_CLOSE') {
						forceClosedCounts += 1;
						forceClosedHoldingDuration += thisHoldingDuration;
						action.forceClosedProfit = thisProfit;
						action.forceClosedTransactionCost = thisTransactionCost;
						forceClosedProfit += thisProfit;
						forceClosedTransactionCost += thisTransactionCost;
					}
				}
			});

			forceClosedCounts += closeCounts;
			forceClosedProfit += profit;
			forceClosedTransactionCost += transactionCost;
			forceClosedHoldingDuration += holdingDuration;

			var result = {
				openCounts: openCounts,
				closeCounts: closeCounts,
				isHolding: !!lastOpen,
				profit: profit,
				transactionCost: transactionCost,
				holdingDuration: holdingDuration,
				profitPerHoldingDay: profit / holdingDuration,

				forceClosedCounts: forceClosedCounts,
				forceClosedProfit: forceClosedProfit,
				forceClosedTransactionCost: forceClosedTransactionCost,
				forceClosedHoldingDuration: forceClosedHoldingDuration,
				forceClosedProfitPerHoldingDay: forceClosedProfit / forceClosedHoldingDuration,

				actions: actions
			};

			if (strategyProcessor.formatResult) strategyProcessor.formatResult(result);

			return result;
		};

		var doAllStrategies = function(strategyProcessor, historicDataset,
				targetDataset, valuePropertyName, options) {
			return StrategyList.map(function(strategy) {
				return {
					historicDataset: historicDataset,
					targetDataset: targetDataset,
					strategy: strategy,
					result: doStrategy(
						strategyProcessor,
						strategy,
						historicDataset,
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
				openAction.stock1Price * openAction.stock1Share * (isLongingStock1? -1 : 1) +
				openAction.stock2Price * openAction.stock2Share * (isLongingStock2? -1 : 1)
			);
			var closeProfit = (
				closeAction.stock1Price * openAction.stock1Share * (isLongingStock1? 1 : -1) +
				closeAction.stock2Price * openAction.stock2Share * (isLongingStock2? 1 : -1)
			);
			return closeProfit + openProfit;
		};

		var _getTransactionCost = function(tCostPercent, openAction, closeAction) {
			if (!closeAction) closeAction = openAction;
			var stock1Cost = openAction.stock1Share * closeAction.stock1Price * tCostPercent;
			var stock2Cost = openAction.stock2Share * closeAction.stock2Price * tCostPercent;
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
			var stock1ShareWeight = 0.5 / openAction.stock1Price;
			var stock2ShareWeight = 0.5 / openAction.stock2Price;
			return {
				stock1Share: tValue * stock1ShareWeight,
				stock2Share: tValue * stock2ShareWeight
			};
		};

		var getBounds = function(lastBounds, strategy, currentRow, lastOpenAction,
				historicDataset, targetDataset, valuePropertyName) {
			if (lastBounds) return lastBounds;
			var std = StatHelper.std(historicDataset, valuePropertyName);
			var mean = StatHelper.mean(historicDataset, valuePropertyName);
			var bounds = {
				open: {
					upper: mean + strategy.open.value * std,
					lower: mean - strategy.open.value * std
				},
				close: {
					upper: mean + strategy.close.value * std,
					lower: mean - strategy.close.value * std
				},
				mean: mean
			};
			return bounds;
		};


		return {
			getStockShares: getStockShares,
			getBounds: getBounds
		};
	}
]);


dataMiningServices.factory('CointegrationStrategyProcessor', [
	'StatHelper',
	function(StatHelper) {

		var getStockShares = function(tValue, openAction) {
			var totalWeight = openAction.stock1Price +
				Math.abs(openAction.cointegrationFactor) * openAction.stock2Price;
			return {
				stock1Share: tValue * 1 / totalWeight,
				stock2Share: tValue * openAction.cointegrationFactor / totalWeight
			};
			// var totalWeight = 1 + Math.abs(openAction.cointegrationFactor);
			// return {
			// 	stock1Share: (tValue / openAction.stock1Price) * 1 / totalWeight,
			// 	stock2Share: (tValue / openAction.stock2Price) * openAction.cointegrationFactor / totalWeight
			// };
		};

		var formatResult = function(result) {
			result.actions.forEach(function(action) {
				if (action.cointegrationFactor > 0) return;
				action.stock2Share = Math.abs(action.stock2Share);
				if (action.stock2Action === 'LONG') action.stock2Action = 'SHORT';
				else if (action.stock2Action === 'SHORT') action.stock2Action = 'LONG';
			});
		};

		var getBounds = function(lastBounds, strategy, currentRow, lastOpenAction,
				historicDataset, targetDataset, valuePropertyName, weightFunc) {
			// if (lastOpenAction) return lastBounds;
			var upToDateDataset = targetDataset.filter(function(row) {
				return row.day <= currentRow.day
			});
			upToDateDataset = historicDataset.concat(upToDateDataset);
			if (weightFunc) {
				var weights = upToDateDataset.map(weightFunc);
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
				mean: mean
			};
			return bounds;
		};

		var useUpdateBoundsWhenClose = function() {
			var _getBounds = getBounds;
			return angular.extend({}, this, {
				getBounds: function(lastBounds, strategy, currentRow, lastOpenAction,
						historicDataset, targetDataset, valuePropertyName) {
					if (lastOpenAction) return lastBounds;
					return _getBounds.apply(this, arguments);
				}
			});
		};

		var useUpdateBoundsNonStop = function() {
			return angular.extend({}, this)
		};

		var useUpdateWeightedBoundsNonStop = function() {
			var _getBounds = getBounds;
			return angular.extend({}, this, {
				getBounds: function(lastBounds, strategy, currentRow, lastOpenAction,
						historicDataset, targetDataset, valuePropertyName) {
					return _getBounds.apply(this, arguments);
				}
			});
		};

		var useNoUpdateBounds = function() {
			var _getBounds = getBounds;
			return angular.extend({}, this, {
				getBounds: function(lastBounds, strategy, currentRow, lastOpenAction,
						historicDataset, targetDataset, valuePropertyName) {
					if (lastBounds) return lastBounds;
					return _getBounds.call(this, lastBounds, strategy, currentRow,
						lastOpenAction, historicDataset, [], valuePropertyName);
				}
			});
		};

		return {
			getStockShares: getStockShares,
			formatResult: formatResult,
			getBounds: getBounds,
			useUpdateBoundsWhenClose: useUpdateBoundsWhenClose,
			useUpdateBoundsNonStop: useUpdateBoundsNonStop,
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
		stocks: '2800.HK, 2801.HK, 2802.HK, 2805.HK, 2808.HK, 2811.HK, 2816.HK, 2817.HK, 2818.HK, 2819.HK, 2821.HK, 2822.HK, 2823.HK, 2824.HK, 2825.HK, 2827.HK, 2828.HK, 2829.HK, 2830.HK, 2832.HK, 2833.HK, 2835.HK, 2836.HK, 2838.HK, 2839.HK, 2840.HK, 2841.HK, 2842.HK, 2844.HK, 2846.HK, 2848.HK, 3001.HK, 3002.HK, 3004.HK, 3005.HK, 3006.HK, 3007.HK, 3008.HK, 3009.HK, 3010.HK, 3011.HK, 3013.HK, 3015.HK, 3016.HK, 3017.HK, 3019.HK, 3020.HK, 3021.HK, 3024.HK, 3025.HK, 3026.HK, 3027.HK, 3029.HK, 3031.HK, 3032.HK, 3035.HK, 3036.HK, 3037.HK, 3039.HK, 3040.HK, 3041.HK, 3043.HK, 3045.HK, 3046.HK, 3048.HK, 3049.HK, 3050.HK, 3051.HK, 3052.HK, 3054.HK, 3055.HK, 3056.HK, 3057.HK, 3060.HK, 3061.HK, 3062.HK, 3063.HK, 3064.HK, 3065.HK, 3066.HK, 3069.HK, 3070.HK, 3071.HK, 3072.HK, 3073.HK, 3075.HK, 3076.HK, 3078.HK, 3081.HK, 3082.HK, 3084.HK, 3085.HK, 3086.HK, 3087.HK, 3089.HK, 3090.HK, 3091.HK, 3092.HK, 3095.HK, 3098.HK, 3099.HK, 3100.HK, 3101.HK, 3102.HK, 3105.HK, 3106.HK, 3107.HK, 3110.HK, 3117.HK, 3118.HK, 3119.HK, 3120.HK, 3121.HK, 3122.HK, 3124.HK, 3126.HK, 3127.HK, 3128.HK, 3129.HK, 3132.HK, 3134.HK, 3136.HK, 3137.HK, 3139.HK, 3140.HK, 3141.HK, 3143.HK, 3145.HK, 3147.HK, 3149.HK, 3150.HK, 3156.HK, 3157.HK, 3160.HK, 3161.HK, 3162.HK, 3165.HK, 3180.HK, 3188.HK, 3199.HK'
	},
	{
		name: 'Dev Testing',
		stocks: '2800.HK, 2833.HK'
	}
]);

dataMiningServices.value('StrategyList', [{
	    "id": "A3",
	    "name": "Open at 2 sd, close at 1.5 sd",
	    "open": {"unit": "std", "value": 2},
	    "close": {"unit": "std", "value": 1.5},
	    "transaction": {"value": 1, "accumalated": false}
	}, {
	    "id": "A2",
	    "name": "Open at 2 sd, close at 1 sd",
	    "open": {"unit": "std", "value": 2},
	    "close": {"unit": "std", "value": 1},
	    "transaction": {"value": 1, "accumalated": false}
	}, {
	    "id": "A1",
	    "name": "Open at 2 sd, close at 0.5 sd",
	    "open": {"unit": "std", "value": 2},
	    "close": {"unit": "std", "value": 0.5},
	    "transaction": {"value": 1, "accumalated": false}
	}, {
	    "id": "A0",
	    "name": "Open at 2 sd, close at 0 sd",
	    "open": {"unit": "std", "value": 2},
	    "close": {"unit": "std", "value": 0},
	    "transaction": {"value": 1, "accumalated": false}
	}, {
	    "id": "B2",
	    "name": "Open at 1.5 sd, close at 1 sd",
	    "open": {"unit": "std", "value": 1.5},
	    "close": {"unit": "std", "value": 1},
	    "transaction": {"value": 1, "accumalated": false}
	}, {
	    "id": "B1",
	    "name": "Open at 1.5 sd, close at 0.5 sd",
	    "open": {"unit": "std", "value": 1.5},
	    "close": {"unit": "std", "value": 0.5},
	    "transaction": {"value": 1, "accumalated": false}
	}, {
	    "id": "B0",
	    "name": "Open at 1.5 sd, close at 0 sd",
	    "open": {"unit": "std", "value": 1.5},
	    "close": {"unit": "std", "value": 0},
	    "transaction": {"value": 1, "accumalated": false}
	}, {
	    "id": "C1",
	    "name": "Open at 1 sd, close at 0.5 sd",
	    "open": {"unit": "std", "value": 1},
	    "close": {"unit": "std", "value": 0.5},
	    "transaction": {"value": 1, "accumalated": false}
	}, {
	    "id": "C0",
	    "name": "Open at 1 sd, close at 0 sd",
	    "open": {"unit": "std", "value": 1},
	    "close": {"unit": "std", "value": 0},
	    "transaction": {"value": 1, "accumalated": false}
	}, {
	    "id": "D0",
	    "name": "Open at 0.5 sd, close at 0 sd",
	    "open": {"unit": "std", "value": 0.5},
	    "close": {"unit": "std", "value": 0},
	    "transaction": {"value": 1, "accumalated": false}
	}
]);