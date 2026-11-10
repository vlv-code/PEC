declare global {
  interface Window {
    [key: string]: any;
  }
  interface HTMLElement {
    value?: any;
    checked?: any;
    disabled?: any;
    src?: any;
    srcdoc?: any;
    contentWindow?: any;
    placeholder?: any;
    files?: any;
    indeterminate?: any;
  }
  interface Element {
    tabIndex?: any;
    disabled?: any;
  }
  interface EventTarget {
    closest?: any;
    classList?: any;
    getAttribute?: any;
    checked?: any;
  }
  interface Response {
    compilerMissing?: boolean;
  }
}

export {};
