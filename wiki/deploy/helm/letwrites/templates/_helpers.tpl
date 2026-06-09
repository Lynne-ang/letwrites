{{- define "letwrites.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "letwrites.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "letwrites.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "letwrites.labels" -}}
app.kubernetes.io/name: {{ include "letwrites.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* Image refs: explicit override wins, else {registry}/<name>:{imageTag} */}}
{{- define "letwrites.bookstackImage" -}}
{{- if .Values.bookstack.image }}{{ .Values.bookstack.image }}{{ else }}{{ printf "%s/letwrites-bookstack:%s" .Values.registry .Values.imageTag }}{{ end -}}
{{- end -}}

{{- define "letwrites.engineImage" -}}
{{- if .Values.engine.image }}{{ .Values.engine.image }}{{ else }}{{ printf "%s/letwrites-engine:%s" .Values.registry .Values.imageTag }}{{ end -}}
{{- end -}}

{{- define "letwrites.secretName" -}}
{{- if .Values.secrets.existingSecret }}{{ .Values.secrets.existingSecret }}{{ else }}{{ include "letwrites.fullname" . }}-secrets{{ end -}}
{{- end -}}
