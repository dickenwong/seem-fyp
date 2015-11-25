'use strict';

/* Services */

var dataMiningServices = angular.module('dataMiningServices', []);

dataMiningServices.factory('YQLHelper', ['$http', '$q', 'Papa',
	function ($http, $q, Papa){
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
					headersInOrder: Papa.parse(resp.data, angular.extend({preview: 1}, config)).data[0],
					results: Papa.parse(resp.data,angular.extend({header: true}, config)).data
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
		var cancelAll = function() {
			canceler.resolve();
			canceler = $q.defer();
			return this;
		};
		return {
			'doYQL': doYQL,
			'cancelAll': cancelAll,
			'getHistoricalData': getHistoricalData,
			'getHistoricalDataViaServer': getHistoricalDataViaServer
		};
	}
]);

dataMiningServices.factory('StatHelper', ['$window', function ($window){
	var _mean = function(stockData, pricePropertyName) {
		if (pricePropertyName == null) pricePropertyName = 'Close';
		var dayCounts = 0;
		return stockData.reduce(function(prev, current) {
			if (current[pricePropertyName] == null) return prev;
			dayCounts += 1;
			return prev + Number(current[pricePropertyName])
		}, 0) / dayCounts;
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

	$window.testStatHelper = {
		mean: _mean,
		std: _std,
		normalize: _normalize,
		normalizeSeries: _normalizeSeries
	};

	return {
		mean: _mean,
		std: _std,
		normalize: _normalize,
		normalizeSeries: _normalizeSeries
	};
}]);

dataMiningServices.factory('PairCalculator', ['$q', 'StatHelper',
	function ($q, StatHelper) {
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

		var byLeastSquare = function(stockData1, stockData2) {
			stockData1 = _toDataByDate(stockData1);
			stockData2 = _toDataByDate(stockData2);
			var dates = _mergeDates(stockData1, stockData2);

			var sumOfSqDelta = 0;
			var dayCounts = 0;
			dates.forEach(function(date) {
				if (!stockData1[date] || !stockData2[date]) return;
				var close1 = +stockData1[date].Close;
				var close2 = +stockData2[date].Close;
				var delta = close1 - close2;
				var sqDelta = delta * delta;
				sumOfSqDelta += sqDelta;
				dayCounts += 1;
			});
			var avgSqDelta = sumOfSqDelta / dayCounts;
			return [avgSqDelta, dayCounts];
		};

		var byLeastSquareDeltaPercentChange = function(stockData1, stockData2) {
			stockData1 = _toDataByDate(stockData1);
			stockData2 = _toDataByDate(stockData2);
			var dates = _mergeDates(stockData1, stockData2);
			dates.sort(function(a, b){return new Date(a) - new Date(b);});

			var sumOfSqDelta = 0;
			var dayCounts = 0;
			dates.forEach(function(date, i) {
				var nextDay = dates[i + 1];
				if (!nextDay) return;
				if (!stockData1[date] || !stockData2[date]) return;
				if (!stockData1[nextDay] || !stockData2[nextDay]) return;
				var day1close1 = +stockData1[date].Close;
				var day2close1 = +stockData1[nextDay].Close;
				var day1close2 = +stockData2[date].Close;
				var day2close2 = +stockData2[nextDay].Close;
				var percentChange1 = (day2close1 - day1close1) / day1close1;
				var percentChange2 = (day2close2 - day1close2) / day1close2;
				var delta = percentChange1 - percentChange2;
				var sqDelta = delta * delta;
				sumOfSqDelta += sqDelta;
				dayCounts += 1;
			});
			var avgSqDelta = sumOfSqDelta / dayCounts;
			return [avgSqDelta, dayCounts];
		};

		var byLeastSquareDeltaOfNormalized = function(stockData1, stockData2, preDefined) {
			var mean1 = preDefined && preDefined.mean1 || StatHelper.mean(stockData1);
			var std1 = preDefined && preDefined.std1 || StatHelper.std(stockData1);
			var mean2 = preDefined && preDefined.mean2 || StatHelper.mean(stockData2);
			var std2 = preDefined && preDefined.std2 || StatHelper.std(stockData2);

			stockData1 = _toDataByDate(stockData1);
			stockData2 = _toDataByDate(stockData2);
			var dates = _mergeDates(stockData1, stockData2);

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

		return {
			// '_toDataByDate': _toDataByDate,
			// '_mergeDates': _mergeDates,
			'byLeastSquare': byLeastSquare,
			'byLeastSquareDeltaPercentChange': byLeastSquareDeltaPercentChange,
			'byLeastSquareDeltaOfNormalized': byLeastSquareDeltaOfNormalized
		};
	}
]);


dataMiningServices.factory('StrategyProcessor',
	['PairCalculator', 'StatHelper', 'StrategyList',
	function (PairCalculator, StatHelper, StrategyList) {

		var _strategies = StrategyList;

		var doStrategy = function(strategy, historicDataset, targetDataset) {
			var std = StatHelper.std(historicDataset, 'deltaValue');
			var _getAbsBound = function(boundInfo) {
				var unitFactor;
				switch (boundInfo.unit) {
					case 'std': unitFactor = StatHelper.std(historicDataset, 'deltaValue'); break;
					case 'mean': unitFactor = StatHelper.mean(historicDataset, 'deltaValue'); break;
					default: unitFactor = 1; break;
				}
				return boundInfo.value * unitFactor
			};
			var openAbsBound = _getAbsBound(strategy.open);
			var closeAbsBound = _getAbsBound(strategy.close);
			var _opening = false;
			var actions = [];
			targetDataset.forEach(function(row) {
				var delta = row.deltaValue;
				if (!_opening && delta * delta >= openAbsBound * openAbsBound) {
					actions.push(angular.extend({}, row, {type: 'OPEN'}));
					_opening = true;
				} else if (_opening && delta * delta <= closeAbsBound * closeAbsBound) {
					actions.push(angular.extend({}, row, {type: 'CLOSE'}));
					_opening = false;
				}
			});
			var calculations = calculateProfit(strategy, actions);
			return angular.extend(calculations, {
				openAbsBound: openAbsBound,
				closeAbsBound: closeAbsBound
			});
		};

		var calculateProfit = function(strategy, actions) {
			var profit = 0;
			var openCounts = 0;
			var closeCounts = 0;
			var holdingDuration = 0;
			var lastOpen;
			var tStrategy = strategy.transaction;
			actions.forEach(function(action) {
				if (action.type == 'OPEN') {
					openCounts += 1;
					lastOpen = action;
				} else if (action.type == 'CLOSE') {
					closeCounts += 1;
					holdingDuration += action.day - lastOpen.day;
					var tValue = tStrategy.value + profit * (+tStrategy.accumalated);
					profit += (-(action.stock1Value - lastOpen.stock1Value) +
						(action.stock2Value - lastOpen.stock2Value)) *
						(lastOpen.deltaValue > 0? 1 : -1) * tValue;
					lastOpen = null;
				}
			});
			if (lastOpen) {
				holdingDuration += actions[actions.length - 1].day - lastOpen.day;
			}
			return {
				profit: profit,
				openCounts: openCounts,
				closeCounts: closeCounts,
				holdingDuration: holdingDuration,
				isHolding: !!lastOpen,
				actions: actions
			};
		};

		var doAllStrategies = function(historicDataset, targetDataset) {
			return _strategies.map(function(strategy) {
				return {
					strategy: strategy,
					result: doStrategy(strategy, historicDataset, targetDataset)
				}
			});
		};

		return {
			doStrategy: doStrategy,
			doAllStrategies: doAllStrategies
		};
	}]
);


dataMiningServices.factory('PairCrawler',
	['$q', 'YQLHelper', 'Papa', 'PairCalculator',
	function ($q, YQLHelper, Papa, PairCalculator) {

		var _stockPool = [];
		var importStockPool = function(csvString) {
			var result = Papa.parse(csvString, {delimiter: ","});
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


dataMiningServices.factory('StockCategories', [function(){
	return [
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
		}
	];
}]);

dataMiningServices.value('StrategyList', [
	{
		name: 'Open at 2 sd, close at 1 sd',
		open: {unit: 'std', value: 2},
		close: {unit: 'std', value: 1},
		transaction: {value: 1, accumalated: false}
	},
	{
		name: 'Open at 2 sd, close at 0.5 sd',
		open: {unit: 'std', value: 2},
		close: {unit: 'std', value: 0.5},
		transaction: {value: 1, accumalated: false}
	},
	{
		name: 'Open at 1.5 sd, close at 0.75 sd',
		open: {unit: 'std', value: 1.5},
		close: {unit: 'std', value: 0.75},
		transaction: {value: 1, accumalated: false}
	},
	{
		name: 'Open at 1.5 sd, close at 0.5 sd',
		open: {unit: 'std', value: 1.5},
		close: {unit: 'std', value: 0.5},
		transaction: {value: 1, accumalated: false}
	},
	{
		name: 'Open at 1 sd, close at 0.5 sd',
		open: {unit: 'std', value: 1},
		close: {unit: 'std', value: 0.5},
		transaction: {value: 1, accumalated: false}
	},
	{
		name: 'Open at 1 sd, close at 0.75 sd',
		open: {unit: 'std', value: 1},
		close: {unit: 'std', value: 0.75},
		transaction: {value: 1, accumalated: false}
	},
	{
		name: 'Open at 1 sd, close at 0.2 sd',
		open: {unit: 'std', value: 1},
		close: {unit: 'std', value: 0.2},
		transaction: {value: 1, accumalated: false}
	},
	{
		name: 'Open at 0.75 sd, close at 0.5 sd',
		open: {unit: 'std', value: 0.75},
		close: {unit: 'std', value: 0.5},
		transaction: {value: 1, accumalated: false}
	},
	{
		name: 'Open at 0.5 sd, close at 0.25 sd',
		open: {unit: 'std', value: 0.5},
		close: {unit: 'std', value: 0.25},
		transaction: {value: 1, accumalated: false}
	},
	{
		name: 'Open at 0.3 sd, close at 0.05 sd',
		open: {unit: 'std', value: 0.3},
		close: {unit: 'std', value: 0.05},
		transaction: {value: 1, accumalated: false}
	}
]);