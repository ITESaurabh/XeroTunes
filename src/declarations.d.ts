/// <reference types="react" />

/** Wildcard declaration for svg-react-loader webpack imports */
declare module 'svg-react-loader*' {
  const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>;
  export default ReactComponent;
}

declare module '*.png' {
  const src: string;
  export default src;
}
