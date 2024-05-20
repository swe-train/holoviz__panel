import type * as p from "@bokehjs/core/properties"
import type {Transform} from "sucrase"

import {ReactiveESM, ReactiveESMView} from "./reactive_esm"

const child_components = `
class Child extends React.Component {

  get views() {
    const model = this.props.parent.model.data[this.props.name]
    const models = Array.isArray(model) ? model : [model]
    const views = []
    for (const submodel of models) {
      const child = this.props.parent.get_child(submodel)
      if (child) {
        views.push(child)
      }
    }
    return views
  }

  get elements() {
    return this.views.map(view => view.el)
  }

  componentDidMount() {
    this.views.map((view) => {
      view.render()
      view.after_render()
    })
    this.props.parent.on_child_render(this.props.name, (new_views) => {
      this.forceUpdate()
      this.views.map((view) => {
        if (new_views.includes(view)) {
          view.render()
          view.after_render()
        }
      })
    })
  }

  render() {
    return React.createElement('div', {className: "child-wrapper", ref: (ref) => ref && this.elements.map(el => ref.appendChild(el))})
  }
}

const children = {}
for (const child of view.model.children) {
  children[child] = React.createElement(Child, {parent: view, name: child})
}`

const state_getter = `
function useState_getter(target, name) {
  if (!Reflect.has(target, name)) {
    return undefined
  }
  const [value, setValue] = React.useState(target.attributes[name]);
  view.model.data.watch(() => {
    setValue(target.attributes[name])
  }, name)
  React.useEffect(() => {
    const state = {}
    state[name] = value
    target.setv(state)
  }, [value])
  return [value, setValue]
}

const modelState = new Proxy(view.model.data, {
  get: useState_getter
})`

export class ReactComponentView extends ReactiveESMView {
  declare model: ReactComponent
  override sucrase_transforms: Transform[] = ["typescript", "jsx"]

  protected override _declare_importmap(): void {
    const react_version = this.model.react_version
    const imports = this.model.importmap?.imports
    const scopes = this.model.importmap?.scopes
    const importMap = {
      imports: {
        react: `https://esm.sh/react@${react_version}`,
        "react-dom/": `https://esm.sh/react-dom@${react_version}/`,
        ...imports,
      },
      scopes: scopes || {},
    }
    if (this.usesMui) {
      importMap.imports = {
        ...importMap.imports,
        "@emotion/cache": "https://esm.sh/@emotion/cache",
        "@emotion/react": "https://esm.sh/@emotion/react",
      }
    }
    // @ts-ignore
    importShim.addImportMap(importMap)
  }

  get usesMui(): boolean {
    if (this.model.importmap?.imports) {
      return Object.keys(this.model.importmap?.imports).some(k => k.startsWith("@mui"))
    }
    return false
  }

  protected override _render_code(): string {
    let render_code
    let import_code = `
import * as React from "react"
import { createRoot } from 'react-dom/client'`
    if (this.usesMui) {
      import_code = `
${import_code}
import createCache from "@emotion/cache"
import { CacheProvider } from '@emotion/react'
`
      render_code = `
const headElement = document.createElement("head")
view.shadow_el.insertBefore(headElement, view.container)

const cache = createCache({
  key: 'css',
  prepend: true,
  container: headElement,
})

if (rendered) {
  view._changing = true
  const root = createRoot(view.container)
  root.render(
    React.createElement(CacheProvider, {value: cache}, rendered)
  )
  view._changing = false;
}`
    } else {
      render_code = `
if (rendered) {
  view._changing = true
  const root = createRoot(view.container)
  root.render(rendered)
  view._changing = false
}`
    }

    return `
${import_code}

const view = Bokeh.index.find_one_by_id('${this.model.id}')

${state_getter}

${child_components}

${this.rendered}

const rendered = render({view: view, model: view.model, data: view.model.data, el: view.container, state: modelState, children: children})

${render_code}`
  }
}

export namespace ReactComponent {
  export type Attrs = p.AttrsOf<Props>

  export type Props = ReactiveESM.Props & {
    react_version: p.Property<string>
  }
}

export interface ReactComponent extends ReactComponent.Attrs {}

export class ReactComponent extends ReactiveESM {
  declare properties: ReactComponent.Props

  constructor(attrs?: Partial<ReactComponent.Attrs>) {
    super(attrs)
  }

  static override __module__ = "panel.models.esm"

  static {
    this.prototype.default_view = ReactComponentView

    this.define<ReactComponent.Props>(({String}) => ({
      react_version: [ String,    "18.2.0" ],
    }))
  }
}
