'use strict';


dataMiningApp
  .filter('percentage', ['$filter', function ($filter) {
    return function (input, decimals) {
      var value = $filter('number')(input * 100, decimals);
      if (value !== '' && value !== NaN && value != null) value += '%';
      return value;
    };
  }])


  .filter('strategyStockAction', ['$filter', function ($filter) {
    return function filter(action, stockNumber) {
      if (action.type === 'DIVIDEND') {
        var dividend = _param('Dividend');
        if (dividend) return '(' + dividend + ' per share)';
        else return '-'
      } else if (action.type === 'OPEN') {
        return (
          _param('AdjClose') + ' (' +
          _param('Action') + ' ' +
          $filter('number')(_param('Share'), 5) + ')'
        );
      } else {
        return _param('AdjClose');
      }

      function _param(paramName) {
        return action['stock' + stockNumber + paramName];
      };
    };

  }])

  .filter('maxProfitPercent', ['$filter', function ($filter) {
    return function filter(strategiesResult) {
      if (!strategiesResult) return;
      var result = strategiesResult.reduce(function(prev, current) {
        var prevPercent = prev.result.forceClosedProfitPercent;
        var currentPercent = current.result.forceClosedProfitPercent;
        return prevPercent > currentPercent? prev : current;
      });
      return $filter('percentage')(result.result.forceClosedProfitPercent, 2) +
        ' (' + result.strategy.id + ')';
    };
  }])

  .filter('medianProfitPercent', ['$filter', '$window', function ($filter, $window) {
    return function filter(strategiesResult) {
      if (!strategiesResult) return;
      var profitPercents = strategiesResult.map(function(result) {
        return result.result.forceClosedProfitPercent;
      });
      var median = $window.ss.median(profitPercents);
      return $filter('percentage')(median, 2);
    };
  }]);
