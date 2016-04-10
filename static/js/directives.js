(function(angular) {


angular.module('dataMiningDirectives', [])
  .directive('tableCellDragSelectable', tableCellDragSelectable);


tableCellDragSelectable.$inject = ['$document'];
function tableCellDragSelectable($document) {
  var directive = {
    restrict: 'A',
    link: link,
    scope: {watchChange: '='}
  };
  return directive;

  function link($scope, element, attrs) {
    $scope.$watch('watchChange', function(newVal, oldVal) {
      var checkboxCells = element.find('.td-checkbox');
      var startCell;
      checkboxCells
        .on('mousedown', function(e) {
          startCell = e.target;
          toggleCellCheckbox(this);
        })
        .on('mouseup', function(e) {
          if (e.target === startCell) toggleCellCheckbox(this);
        })
        .on('mouseenter', function(e) {
          if (e.buttons % 2 === 1) toggleCellCheckbox(this);
        })
        .on('mousemove', function(e) {
          e.preventDefault();
          return false;
        });
    });
  }

  function toggleCellCheckbox(cell) {
    var checkbox = angular.element(cell).find('input[type=checkbox]');
    checkbox.click();
  }
}


})(angular);