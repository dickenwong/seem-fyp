'use strict';


var dataMiningApp = angular.module('dataMiningApp', [
    'dataMiningControllers',
    'dataMiningServices'
]);

if (typeof google !== 'undefined') {
	dataMiningApp.constant('google', google);
	dataMiningApp.run(['google', function(google) {
	    google.load('visualization', '1.1', {
	        packages: ['corechart'],
	        callback: function() {}
	    });
	}]);
}