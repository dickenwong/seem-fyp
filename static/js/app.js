'use strict';

var dataMiningApp = angular.module('dataMiningApp', [
    'dataMiningControllers',
    'dataMiningServices'
]);

dataMiningApp.constant('Papa', Papa);
dataMiningApp.constant('google', google);
dataMiningApp.run(['google', function(google) {
    google.load('visualization', '1.1', {
        packages: ['line'],
        callback: function() {}
    });
}]);