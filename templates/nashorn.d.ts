/**
 * Nashorn JavaScript Engine type definitions
 * Provides type information for Java interop features
 */

declare namespace Java {
  /**
   * Creates a reference to a Java class that can be used from JavaScript
   * @param className Fully qualified Java class name
   */
  function type<T = any>(className: string): T;

  /**
   * Extends a Java class or implements Java interfaces
   */
  function extend(...types: any[]): any;

  /**
   * Converts JavaScript objects to Java objects
   */
  function to(jsObject: any, javaType?: any): any;

  /**
   * Converts Java objects to JavaScript objects
   */
  function from(javaObject: any): any;

  /**
   * Tests if an object is a Java object
   */
  function isJavaObject(obj: any): boolean;

  /**
   * Tests if an object is a Java method
   */
  function isJavaMethod(obj: any): boolean;

  /**
   * Tests if an object is a script object
   */
  function isScriptObject(obj: any): boolean;

  /**
   * Tests if an object is a script function
   */
  function isScriptFunction(obj: any): boolean;

  /**
   * Synchronizes on a Java object
   */
  function synchronized(func: Function, obj: any): any;

  /**
   * Creates a Java array
   */
  function asJSONCompatible(obj: any): any;
}

/**
 * Global variables that may be provided by the Nashorn/Maximo environment
 */
declare var request: any;
declare var requestBody: any;
declare var userInfo: any;
declare var result: any;
