;(function(angular) {
"use strict";

// This has to be declared here
// because this is concatinated
// BEFORE the provider, which defines it
var mappings = {};
var bypassAll = false;
var globalMiddleware = {
	middleware: []
};

var $middlewareFactory = [
'$injector', '$q',
function middlewareFactory($injector, $q) {
	
	/**
	 * This object is used to group
	 * private middleware properties
	 * that are used throughout this
	 */
	var middleware = {
		next: nextMiddleware
	};

	/**
	 * This object is passed
	 * to the invoked middleware
	 * and is used as the main API
	 */
	var request = {
		next: nextRequest,
		redirectTo: redirectTo
	};

	/**
	 * Initialize $middleware
	 *
	 * @param {object} toRoute
	 * @param {mixed} toParams
	 * @returns {promise}
	 */
	return function initialize(toRoute, toParams) {
		// Return early if the toRoute doesn't have middleware
		if ( !hasMiddleware(globalMiddleware) && !hasMiddleware(toRoute) ) return;

		// Store a copy of the route parameters in the request
		request.params = angular.copy(toParams);

		// Set the middleware index to 0
		middleware.index = 0;

		// Set the middleware names.
		// Make sure the globals are first, then concat toRoute
		middleware.names =
			getMiddlewareNames(globalMiddleware)
			.concat(getMiddlewareNames(toRoute));

		// Create a deferred promise
		middleware.resolution = $q.defer();

		// If we are bypassing everything,
		// then go ahead and resolve now
		if ( bypassAll ) middleware.resolution.resolve();

		// We're not bypassing it,
		// so process that first middleware!
		else middleware.next();

		// Return the promise
		return middleware.resolution.promise;
	};

	/**
	 * Determine if the given route has middleware
	 *
	 * @param {object} toRoute
	 * @returns {boolean}
	 */
	function hasMiddleware(route) {
		return !!route.middleware;
	}

	/**
	 * Get the middleware names
	 * from an array or a piped string
	 *
	 * @param {object} route
	 * @returns {array}
	 */
	function getMiddlewareNames(route) {
		// Return the middleware names as an array
		return route.middleware instanceof Array
			? route.middleware
			: typeof route.middleware === 'undefined'
				? []
				: route.middleware.split('|');
	}

	/**
	 * Attempt to invoke the next middleware
	 *
	 * @returns {void}
	 */
	function nextMiddleware() {
		// Get the next middleware
		var next = mappings[middleware.names[middleware.index++]];

		// If there is middleware, then invoke it, binding request
		if ( next ) $injector.invoke(next, request);
	}

	/**
	 * Go to the next request.
	 * If there are more middleware,
	 * then go to the next middleware.
	 * Otherwise, resolve the middleware resolution.
	 *
	 * @returns {void}
	 */
	function nextRequest() {
		// If there are no more middleware,
		// then resolve the middleware resolution
		if ( middleware.index == middleware.names.length ) {
			middleware.resolution.resolve();
		}

		// Attempt to invoke the next middleware
		middleware.next();
	}

	/**
	 * Redirect to another route
	 *
	 * @returns {void}
	 */
	function redirectTo(route) {
		middleware.resolution.reject('redirectTo:' + route);
	}
}];

var $middleware = function middlewareProvider() {
	/**
	 * Create custom middleware mappings
	 *
	 * @param {object} customMappings
	 * @return {void}
	 */
	this.map = function map(customMappings) {
		// Make sure customMappings is an object
		if ( typeof customMappings !== 'object' ) {
			throw 'Your middleware map must be an object!';
		}

		// Set the mappings
		mappings = customMappings;
	};

	/**
	 * Determine if we want to bypass all middleware.
	 * This is good for debugging.
	 *
	 * @param {boolean} enableBypass
	 * @return {void}
	 */
	this.bypassAll = function bypassAll(enableBypass) {
		// Make sure enableBypass is boolean
		if ( typeof enableBypass !== 'boolean' ) {
			throw 'You must provide bypassAll with a boolean value!';
		}

		// Set it!
		bypassAll = enableBypass;
	};

	this.global = function global(customGlobalMiddleware) {
		// Make sure it's a string or an array
		if ( typeof customGlobalMiddleware !== 'string' && !angular.isArray(customGlobalMiddleware) ) {
			throw 'You must provide a string, a string separated by pipes, or an array of middleware names';
		}

		// Set it... and don't forget it.
		globalMiddleware.middleware = customGlobalMiddleware;
	};

	/** This is the provider's entry point */
	this.$get = $middlewareFactory;
};

angular.module('ngRoute.middleware', []).provider('$middleware', $middleware)

.config(['$provide', function configureRouteProvider($provide) {
	// Init resolve:{} to all routes
	$provide.decorator('$route', ['$delegate', function decorateRoute($delegate) {
		// Go through each route & make sure resolve is set on all children
		angular.forEach($delegate.routes, function addResolveObject(route) {
			route.resolve = route.resolve || {};
		});

		// Return the delegate
		return $delegate;
	}]);
}])

.run(['$rootScope', '$route', '$location', '$middleware',
function handleMiddleware($rootScope, $route, $location, $middleware) {
	/**
	 * Handle middleware
	 */
	$rootScope.$on('$routeChangeStart', function routeChangeStarted(event, next, current) {
		next.resolve.middleware = function resolveNextMiddleware() {
			return $middleware(next, next.params);
		};
	});

	/**
	 * Handle redirects from middleware
	 */
	$rootScope.$on('$routeChangeError', function handleMiddlewareRedirects(event, current, previous, rejection) {
		var pattern = /redirectTo\:(.*)/; 
		var match;

		// Only proceed if there is a match to the pattern
		if ((match = pattern.exec(rejection)) !== null) {
			// Prevent the route change from working normally
			event.preventDefault();

			// If the redirect route is the same, then just reload
			if ( current.regexp.test(match[1]) ) {
				return $route.reload();
			}

			// The path is new, so go there!
			$location.path(match[1]);
		}
	});
}]);

angular.module('ui.router.middleware', []).provider('$middleware', $middleware)

.config(['$stateProvider', function configureStateProvider($stateProvider) {
	// Init resolve:{} to all states
	// https://github.com/angular-ui/ui-router/issues/1165
	$stateProvider.decorator('path', function(state, parentFn) {
		if ( typeof state.self.resolve === 'undefined' ) {
			state.self.resolve = {};
			state.resolve = state.self.resolve;
		}
		return parentFn(state);
	});
}])

.run(['$rootScope', '$state', '$middleware',
function handleMiddleware($rootScope, $state, $middleware) {
	/**
	 * Handle middleware
	 */
	$rootScope.$on('$stateChangeStart', function stateChangeStarted(event, toState, toParams) {
		// Force the state to resolve the middleware before loading
		toState.resolve.middleware = function resolveNextMiddleware() {
			return $middleware(toState, toParams);
		};
	});

	/**
	 * Handle redirects from middleware
	 */
	$rootScope.$on('$stateChangeError', function handleMiddlewareRedirects(event, toState, toParams, fromState, fromParams, error) {
		var pattern = /redirectTo\:(.*)/; 
		var match;

		// Only proceed if there is a match to the pattern
		if ((match = pattern.exec(error)) !== null) {
			// Prevent state change error from working normally
			event.preventDefault();
			
			// Redirect, allowing reloading and preventing url param inheritance
			// https://github.com/angular-ui/ui-router/wiki/Quick-Reference#statetransitiontoto-toparams--options
			return $state.transitionTo(match[1], null, {
				location: true,
				inherit: false,
				relative: $state.$current,
				notify: true,
				reload: true
			});
		}
	});
}]);
}(angular));
