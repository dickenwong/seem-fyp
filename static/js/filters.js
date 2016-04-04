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
    return filter;

    function filter(action, stockNumber) {
      if (action.type === 'DIVIDEND') {
        var dividend = _param('Dividend');
        if (dividend) return '(' + dividend + ' per share)';
        else return '-'
      } else if (action.type === 'OPEN') {
        return (
          _param('Price') + ' (' +
          _param('Action') + ' ' +
          $filter('number')(_param('Share'), 5) + ')'
        );
      } else {
        return _param('Price');
      }

      function _param(paramName) {
        return action['stock' + stockNumber + paramName];
      };
    };

  }]);
