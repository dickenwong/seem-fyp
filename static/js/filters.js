'use strict';


dataMiningApp.filter('percentage', ['$filter', function ($filter) {
  return function (input, decimals) {
    var value = $filter('number')(input * 100, decimals);
    if (value !== '' && value !== NaN && value != null) value += '%';
    return value;
  };
}]);
