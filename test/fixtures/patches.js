// Real-world patch examples for testing

export const ADD_ONLY_PATCH = `@@ -0,0 +1,5 @@
+function newFunction() {
+  console.log("This is new code");
+  return true;
+}
+`;

export const REPLACE_PATCH = `@@ -10,3 +10,4 @@ function oldFunction() {
-  const oldVar = 10;
-  return oldVar;
+  const newVar = 20;
+  console.log("Modified");
+  return newVar;
 }`;

export const DELETE_ONLY_PATCH = `@@ -15,5 +15,2 @@ function cleanup() {
-  // Old comment
-  const unused = 5;
-  console.log("deprecated");
   return;
 }`;

export const BLANK_LINES_REMOVED_PATCH = `@@ -20,4 +20,3 @@ function compact() {
-
-
   const value = 10;
+  const newValue = 20;
   return value;
 }`;

export const BLANK_LINES_ADDED_PATCH = `@@ -30,2 +30,5 @@ function spacing() {
   const a = 1;
+
+
   const b = 2;
 }`;

export const MIXED_HUNKS_PATCH = `@@ -1,0 +2,3 @@ class MyClass {
+  constructor() {
+    this.value = 0;
+  }
@@ -10,2 +13,2 @@ class MyClass {
-  oldMethod() {
+  newMethod() {
     return this.value;
@@ -20,0 +23,5 @@ class MyClass {
+
+  anotherNewMethod() {
+    return this.value * 2;
+  }
 }`;

export const FORMATTING_PATCH = `@@ -5,3 +5,3 @@ const config = {
-  option1: true,
-  option2: false,
-  option3: "value"
+  option1: true,
+  option2: false,
+  option3: "value",
 };`;

export const WHITESPACE_ONLY_PATCH = `@@ -10,2 +10,2 @@ function test() {
-  
-  
+
+
   return true;
 }`;

