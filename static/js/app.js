'use strict';

var dataMiningApp = angular.module('dataMiningApp', [
    'dataMiningControllers',
    'dataMiningServices'
]);

dataMiningApp.constant('Papa', Papa);
