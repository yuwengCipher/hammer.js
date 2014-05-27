var MOBILE_REGEX = /mobile|tablet|ip(ad|hone|od)|android|silk/i;

var SUPPORT_POINTER_EVENTS = prefixed('PointerEvent', window);
var SUPPORT_TOUCH = ('ontouchstart' in window);
var SUPPORT_ONLY_TOUCH = SUPPORT_TOUCH && MOBILE_REGEX.test(navigator.userAgent);

var INPUT_TYPE_TOUCH = 'touch';
var INPUT_TYPE_PEN = 'pen';
var INPUT_TYPE_MOUSE = 'mouse';

var EVENT_START = 1;
var EVENT_MOVE = 2;
var EVENT_END = 4;
var EVENT_CANCEL = 8;

var DIRECTION_LEFT = 'left';
var DIRECTION_RIGHT = 'right';
var DIRECTION_UP = 'up';
var DIRECTION_DOWN = 'down';
var DIRECTION_NONE = '';

var PROPS_XY = ['x', 'y'];
var PROPS_CLIENT_XY = ['clientX', 'clientY'];

/**
 * create new input type instance
 * @param {Instance} inst
 * @param {Function} callback
 * @returns {Input}
 * @constructor
 */
function Input(inst, callback) {
    this.inst = inst;
    this.callback = callback;

    // used for internal events
    this._handler = bindFn(this.handler, this);

    this._elEvents && addEvent(this.inst.element, this._elEvents, this._handler);
    this._winEvents && addEvent(window, this._winEvents, this._handler);
}

Input.prototype = {
    destroy: function() {
        this._elEvents && removeEvent(this.inst.element, this._elEvents, this._handler);
        this._winEvents && removeEvent(window, this._winEvents, this._handler);
    }
};

/**
 * create new input type instance
 * @param {Hammer} inst
 * @returns {Input}
 */
function createInputInstance(inst) {
    var Type;
    if(SUPPORT_POINTER_EVENTS) {
        Type = PointerEventInput;
    } else if(SUPPORT_ONLY_TOUCH) {
        Type = TouchInput;
    } else if(!SUPPORT_TOUCH) {
        Type = MouseInput;
    } else {
        Type = TouchMouseInput;
    }
    return new (Type)(inst, inputHandler);
}

/**
 * handle input events
 * @param {Instance} inst
 * @param {String} eventType
 * @param {Object} inputData
 */
function inputHandler(inst, eventType, inputData) {
    var pointersLen = inputData.pointers.length;
    var changedPointersLen = inputData.changedPointers.length;

    var isFirst = (eventType === EVENT_START && (pointersLen - changedPointersLen === 0));
    var isFinal = (eventType === EVENT_END && (pointersLen - changedPointersLen === 0));

    inputData.isFirst = isFirst;
    inputData.isFinal = isFinal;

    if(eventType === EVENT_START && inputData.isFirst) {
        inst.session = {};
    }
    // source event is the normalized value of the events like 'touchstart, touchend, touchcancel, pointerdown'
    inputData.eventType = eventType;

    // compute scale, rotation etc
    computeInputData(inst.session, inputData);

    inst.update(inputData);
}

/**
 * extend the data with some usable properties like scale, rotate, velocity etc
 * @param {Object} session
 * @param {Object} inputData
 */
function computeInputData(session, inputData) {
    var pointers = inputData.pointers;
    var pointersLength = pointers.length;

    // store the first input to calculate the distance and direction
    if(!session.firstInput) {
        session.firstInput = simpleCloneInputData(inputData);
    }

    // to compute scale and rotation we need to store the multiple touches
    if(pointersLength > 1 && !session.firstMultiple) {
        session.firstMultiple = simpleCloneInputData(inputData);
    } else if(pointersLength === 1) {
        session.firstMultiple = false;
    }

    var firstInput = session.firstInput;
    var firstMultiple = session.firstMultiple;
    var offsetCenter = firstMultiple ? firstMultiple.center : firstInput.center;

    var center = getCenter(pointers);

    inputData.timeStamp = inputData.srcEvent.timeStamp;

    inputData.center = center;
    inputData.angle = getAngle(offsetCenter, center);
    inputData.distance = getDistance(offsetCenter, center);
    inputData.direction = getDirection(offsetCenter, center);

    inputData.velocity = 0.5;
    inputData.velocityX = 0.5;
    inputData.velocityY = 0.5;

    inputData.deltaTime = inputData.timeStamp - firstInput.timeStamp;
    inputData.deltaX = center.x - offsetCenter.x;
    inputData.deltaY = center.y - offsetCenter.y;

    inputData.scale = firstMultiple ? getScale(firstMultiple.pointers, pointers) : 1;
    inputData.rotation = firstMultiple ? getRotation(firstMultiple.pointers, pointers) : 0;
}

/**
 * create a simple clone from the inputData used for storage of firstInput and firstMultiple
 * @param {Object} inputData
 * @returns {Object} clonedInputData
 */
function simpleCloneInputData(inputData) {
    // make a simple copy of the pointers because we will get a reference if we don't
    // we only need clientXY for the calculations
    var pointers = [];
    each(inputData.pointers, function(pointer) {
        pointers.push({
            clientX: round(pointer.clientX),
            clientY: round(pointer.clientY)
        });
    });

    return {
        timeStamp: inputData.srcEvent.timeStamp,
        pointers: pointers,
        center: getCenter(pointers)
    };
}

/**
 * get the center of all the pointers
 * @param {Array} pointers
 * @return {Object} center contains `x` and `y` properties
 */
function getCenter(pointers) {
    // no need to loop when only one touch
    if(pointers.length === 1) {
        return {
            x: round(pointers[0].clientX),
            y: round(pointers[0].clientY)
        };
    }

    var x = [],
        y = [];

    each(pointers, function(pointer) {
        x.push(pointer.clientX);
        y.push(pointer.clientY);
    });

    return {
        x: round((Math.min.apply(Math, x) + Math.max.apply(Math, x)) / 2),
        y: round((Math.min.apply(Math, y) + Math.max.apply(Math, y)) / 2)
    };
}

/**
 * get the direction between two points
 * @param {Object} p1 {x, y}
 * @param {Object} p2 {x, y}
 * @return {String} direction matches `DIRECTION_NONE|LEFT|RIGHT|UP|DOWN`
 */
function getDirection(p1, p2) {
    var x = p1.x - p2.x,
        y = p1.y - p2.y;

    // no direction because the positions are equal
    if(x === y) {
        return DIRECTION_NONE;
    }

    if(Math.abs(x) >= Math.abs(y)) {
        return x > 0 ? DIRECTION_LEFT : DIRECTION_RIGHT;
    }
    return y > 0 ? DIRECTION_UP : DIRECTION_DOWN;
}

/**
 * calculate the absolute distance between two points
 * @param {Object} p1 {x, y}
 * @param {Object} p2 {x, y}
 * @param {Array} [props] containing x and y keys
 * @return {Number} distance
 */
function getDistance(p1, p2, props) {
    if(!props) {
        props = PROPS_XY;
    }
    var x = p2[props[0]] - p1[props[0]],
        y = p2[props[1]] - p1[props[1]];
    return Math.sqrt((x * x) + (y * y));
}

/**
 * calculate the angle between two coordinates
 * @param {Object} p1
 * @param {Object} p2
 * @param {Array} [props] containing x and y keys
 * @return {Number} angle
 */
function getAngle(p1, p2, props) {
    if(!props) {
        props = PROPS_XY;
    }
    var x = p2[props[0]] - p1[props[0]],
        y = p2[props[1]] - p1[props[1]];
    return Math.atan2(y, x) * 180 / Math.PI;
}

/**
 * calculate the rotation degrees between two pointersets
 * @param {Array} start array of pointers
 * @param {Array} end array of pointers
 * @return {Number} rotation
 */
function getRotation(start, end) {
    return getAngle(end[1], end[0], PROPS_CLIENT_XY) - getAngle(start[1], start[0], PROPS_CLIENT_XY);
}

/**
 * calculate the scale factor between two pointersets
 * no scale is 1, and goes down to 0 when pinched together, and bigger when pinched out
 * @param {Array} start array of pointers
 * @param {Array} end array of pointers
 * @return {Number} scale
 */
function getScale(start, end) {
    return getDistance(end[0], end[1], PROPS_CLIENT_XY) / getDistance(start[0], start[1], PROPS_CLIENT_XY);
}
