"use strict";

var PROJECT_COLORS = ["#5c1f2d", "#c98b7f", "#b0904a", "#7d5a6b", "#8b5a3c"];
var API_TOKEN_KEY = "mindspace-api-token";

function serverApp() {
    return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function storedApiToken() {
    try {
        return window.localStorage.getItem(API_TOKEN_KEY) || "";
    } catch (error) {
        return "";
    }
}

async function apiRequest(path, options) {
    var request = Object.assign({}, options || {});
    var token = request.token || storedApiToken();
    delete request.token;
    request.headers = Object.assign({ Accept: "application/json" }, request.headers || {});

    if (request.body && !(request.body instanceof FormData)) {
        request.headers["Content-Type"] = "application/json";
        request.body = JSON.stringify(request.body);
    }
    if (token) {
        request.headers.Authorization = "Bearer " + token;
    }

    var response;
    try {
        response = await fetch("/api" + path, request);
    } catch (error) {
        throw new Error("Сервер недоступен. Проверьте подключение и попробуйте ещё раз.");
    }

    if (response.status === 204) return {};
    var result = {};
    try {
        result = await response.json();
    } catch (error) {
        if (response.ok) {
            throw new Error("Сервер вернул ответ в неожиданном формате.");
        }
    }

    if (!response.ok) {
        var apiError = new Error(result.error && result.error.message
            ? result.error.message
            : "Запрос не выполнен (HTTP " + response.status + ").");
        apiError.code = result.error && result.error.code;
        apiError.status = response.status;
        apiError.details = result.error && result.error.details;
        throw apiError;
    }
    return result.data || {};
}

function apiMode() {
    return serverApp() && Boolean(storedApiToken());
}

function canEditProject(projectId) {
    var project = state.projects.find(function (item) {
        return String(item.id) === String(projectId);
    });
    return !apiMode() || Boolean(project && project.memberRole !== "viewer");
}

async function reloadApiWorkspace() {
    var results = await Promise.all([
        apiRequest("/projects"),
        apiRequest("/tasks"),
        apiRequest("/notifications/invitations")
    ]);
    state.projects = results[0].projects.map(function (project) {
        project.id = String(project.id);
        return project;
    });
    state.tasks = results[1].tasks.map(function (task) {
        task.id = String(task.id);
        task.projectId = String(task.projectId);
        task.dependsOn = (task.dependsOn || []).map(String);
        return task;
    });
    state.invitations = results[2].invitations;
    if (state.project !== "all" && !state.projects.some(function (project) {
        return project.id === state.project;
    })) {
        state.project = "all";
    }
    saveState();
    renderAll();
}

async function changeTaskStatus(taskId, nextStatus) {
    var task = taskById(taskId);
    if (!task || task.status === nextStatus) return { ok: true };
    if (apiMode()) {
        try {
            await apiRequest("/tasks/" + encodeURIComponent(taskId) + "/status", {
                method: "PATCH",
                body: { status: nextStatus }
            });
            await reloadApiWorkspace();
            animateTaskStatusChange(taskId);
            return { ok: true };
        } catch (error) {
            showToast("error", "Не удалось изменить статус", error.message);
            renderAll();
            return { ok: false, message: error.message };
        }
    }
    return moveTask(taskId, nextStatus);
}

async function openInvitationsModal() {
    try {
        var result = await apiRequest("/notifications/invitations");
        state.invitations = result.invitations;
        var body = h("div", { class: "invite-list" });
        if (!state.invitations.length) {
            body.appendChild(h("p", { class: "muted", text: "Новых приглашений пока нет." }));
        }
        state.invitations.forEach(function (invitation) {
            var actions = h("div", { class: "toolbar" }, [
                h("button", {
                    class: "btn btn-primary btn-small",
                    type: "button",
                    text: "Принять",
                    on: { click: function () { respondToInvitation(invitation.id, "accept"); } }
                }),
                h("button", {
                    class: "btn btn-ghost btn-small",
                    type: "button",
                    text: "Отклонить",
                    on: { click: function () { respondToInvitation(invitation.id, "decline"); } }
                })
            ]);
            body.appendChild(h("article", { class: "card", style: "margin-bottom:12px" }, [
                h("strong", { text: invitation.projectName }),
                h("p", { class: "muted", text: invitation.inviterName + " приглашает вас · " +
                    (invitation.role === "editor" ? "редактирование" : "только просмотр") }),
                actions
            ]));
        });
        openModal("Приглашения в проекты", body, [
            h("button", { class: "btn btn-ghost", type: "button", text: "Закрыть", on: { click: closeModal } })
        ]);
    } catch (error) {
        showToast("error", "Не удалось загрузить приглашения", error.message);
    }
}

async function respondToInvitation(id, action) {
    try {
        await apiRequest("/notifications/invitations/" + encodeURIComponent(id) + "/respond", {
            method: "POST",
            body: { action: action }
        });
        await reloadApiWorkspace();
        showToast("success", action === "accept" ? "Вы вступили в проект" : "Приглашение отклонено");
        await openInvitationsModal();
    } catch (error) {
        showToast("error", "Не удалось ответить на приглашение", error.message);
    }
}

async function openProjectSharing() {
    var project = state.projects.find(function (item) {
        return String(item.id) === String(state.project);
    });
    if (!project) {
        showToast("warning", "Выберите проект", "Сначала выберите проект, которым хотите поделиться.");
        return;
    }
    var projectId = encodeURIComponent(project.id);
    try {
        var result = await apiRequest("/projects/" + projectId + "/members");
        var body = h("div", {});
        if (result.currentRole === "owner") {
            var email = h("input", { type: "email", placeholder: "Электронная почта участника" });
            var role = h("select", {}, [
                h("option", { value: "editor", text: "Редактирование" }),
                h("option", { value: "viewer", text: "Только просмотр" })
            ]);
            var inviteError = h("p", { class: "field_error" });
            var inviteForm = h("form", { class: "toolbar" }, [
                email, role,
                h("button", { class: "btn btn-primary", type: "submit", text: "Пригласить" })
            ]);
            inviteForm.addEventListener("submit", async function (event) {
                event.preventDefault();
                inviteError.textContent = "";
                try {
                    await apiRequest("/projects/" + projectId + "/invitations", {
                        method: "POST",
                        body: { email: email.value.trim(), role: role.value }
                    });
                    showToast("success", "Приглашение создано",
                        "Оно появится у пользователя в приложении после входа.");
                    await openProjectSharing();
                } catch (error) {
                    inviteError.textContent = error.message;
                }
            });
            body.appendChild(h("p", {
                class: "field-help",
                text: "Письма не отправляются. Приглашение появится в приложении у пользователя с этим адресом."
            }));
            body.appendChild(inviteForm);
            body.appendChild(inviteError);
        } else {
            body.appendChild(h("p", { class: "field-help", text: "Управлять участниками может только владелец проекта." }));
        }

        var members = h("div", { style: "margin-top:18px" });
        result.members.forEach(function (member) {
            var isOwner = member.role === "owner";
            var roleControl = h("select", { disabled: result.currentRole !== "owner" || isOwner }, [
                h("option", { value: "editor", text: "Редактирование" }),
                h("option", { value: "viewer", text: "Только просмотр" })
            ]);
            if (!isOwner) roleControl.value = member.role;
            roleControl.addEventListener("change", async function () {
                try {
                    await apiRequest("/projects/" + projectId + "/members/" + encodeURIComponent(member.id), {
                        method: "PATCH", body: { role: roleControl.value }
                    });
                    showToast("success", "Права участника обновлены");
                } catch (error) {
                    showToast("error", "Не удалось изменить права", error.message);
                    roleControl.value = member.role;
                }
            });
            var removeButton = null;
            if (!isOwner && (result.currentRole === "owner" || Number(member.id) === Number(state.user.id))) {
                removeButton = h("button", {
                    class: "btn btn-ghost btn-small",
                    type: "button",
                    text: Number(member.id) === Number(state.user.id) ? "Покинуть" : "Удалить",
                    on: {
                        click: async function () {
                            try {
                                await apiRequest("/projects/" + projectId + "/members/" + encodeURIComponent(member.id), {
                                    method: "DELETE"
                                });
                                await reloadApiWorkspace();
                                showToast("success", "Доступ к проекту удалён");
                                closeModal();
                            } catch (error) {
                                showToast("error", "Не удалось удалить участника", error.message);
                            }
                        }
                    }
                });
            }
            members.appendChild(h("div", { class: "toolbar", style: "justify-content:space-between;margin:10px 0" }, [
                h("span", { text: member.name + " · " + member.email }),
                roleControl,
                removeButton
            ]));
        });
        body.appendChild(h("h4", { text: "Участники проекта", style: "margin-top:18px" }));
        body.appendChild(members);
        openModal("Совместный доступ · " + project.name, body, [
            h("button", { class: "btn btn-ghost", type: "button", text: "Закрыть", on: { click: closeModal } })
        ]);
    } catch (error) {
        showToast("error", "Не удалось загрузить участников", error.message);
    }
}

function fieldBox(label, control, key) {
    return h("label", { class: "field", data: { field: key } }, [
        h("span", { text: label }),
        control,
        h("em", { class: "field_error" })
    ]);
}

function setFormErrors(form, errors) {
    form.querySelectorAll("[data-field]").forEach(function (box) {
        var key = box.dataset.field;
        var message = errors[key] || "";
        var output = box.querySelector(".field_error");
        box.classList.toggle("is-invalid", Boolean(message));
        if (output) {
            output.textContent = message;
        }
    });
}

function selectBox(key, options, value) {
    var select = h("select", { data: { input: key } }, options.map(function (option) {
        return h("option", { value: option.id, text: option.title });
    }));
    select.value = value;
    return select;
}

function textBox(key, value, placeholder, type) {
    return h("input", {
        type: type || "text",
        value: value === 0 || value ? String(value) : "",
        placeholder: placeholder || "",
        data: { input: key }
    });
}

function dependencyPicker(currentId, values) {
    var list = h("div", { class: "dep-list" });
    var search = h("input", {
        class: "dep-search",
        type: "search",
        placeholder: "Найти задачу для зависимости"
    });
    var candidates = state.tasks.filter(function (task) {
        return task.id !== currentId;
    });

    function fill() {
        clear(list);
        var query = search.value.trim().toLowerCase();
        var found = candidates.filter(function (task) {
            return !query || task.title.toLowerCase().indexOf(query) !== -1;
        });

        if (!found.length) {
            list.appendChild(h("p", {
                class: "faint",
                style: "padding:10px",
                text: "Подходящих задач нет"
            }));
            return;
        }

        found.forEach(function (task) {
            var box = h("input", { type: "checkbox" });
            box.checked = values.dependsOn.indexOf(task.id) !== -1;
            box.addEventListener("change", function () {
                var index = values.dependsOn.indexOf(task.id);
                if (box.checked && index === -1) {
                    values.dependsOn.push(task.id);
                }
                if (!box.checked && index !== -1) {
                    values.dependsOn.splice(index, 1);
                }
            });

            list.appendChild(h("label", { class: "dep-option" }, [
                box,
                h("span", {}, [
                    h("span", { text: task.title }),
                    h("small", {
                        text: statusById(task.status).title + " · " + projectById(task.projectId).name
                    })
                ])
            ]));
        });
    }

    search.addEventListener("input", fill);
    fill();

    var summary = h("summary", {
        class: "dep-picker_summary",
        text: values.dependsOn.length
            ? "Выбрано задач: " + values.dependsOn.length
            : "Добавить зависимость"
    });
    var picker = h("details", {
        class: "dep-picker",
        open: values.dependsOn.length ? "open" : null,
        on: {
            toggle: function () {
                if (values.dependsOn.length) {
                    summary.textContent = "Выбрано задач: " + values.dependsOn.length;
                } else {
                    summary.textContent = picker.open ? "Выберите задачи" : "Добавить зависимость";
                }
            }
        }
    }, [
        summary,
        h("p", {
            class: "dep-picker_help",
            text: "Связанные задачи нужно завершить прежде, чем начинать эту."
        }),
        search,
        list
    ]);

    list.addEventListener("change", function () {
        summary.textContent = values.dependsOn.length
            ? "Выбрано задач: " + values.dependsOn.length
            : "Зависимость не выбрана";
    });
    return picker;
}

function collectTaskValues(form, values) {
    var result = {
        title: form.querySelector('[data-input="title"]').value,
        description: form.querySelector('[data-input="description"]').value,
        projectId: form.querySelector('[data-input="projectId"]').value,
        priority: form.querySelector('[data-input="priority"]').value,
        status: form.querySelector('[data-input="status"]').value,
        dueDate: form.querySelector('[data-input="dueDate"]').value,
        estimate: form.querySelector('[data-input="estimate"]').value,
        dependsOn: values.dependsOn.slice(),
        tags: form.querySelector('[data-input="tags"]').value.split(",").map(function (tag) {
            return tag.trim();
        }).filter(Boolean)
    };
    return result;
}

function openTaskForm(id) {
    var task = id ? taskById(id) : null;
    var values = {
        dependsOn: task ? task.dependsOn.slice() : []
    };
    var editableProjects = state.projects.filter(function (project) {
        return canEditProject(project.id);
    });
    var defaultProject = state.project !== "all" && canEditProject(state.project)
        ? state.project
        : (editableProjects[0] ? editableProjects[0].id : "");

    var form = h("form", { class: "form-grid", novalidate: "novalidate" }, [
        h("div", { class: "field full", data: { field: "title" } }, [
            h("span", { text: "Название задачи" }),
            textBox("title", task ? task.title : "", "Например: собрать макет экрана"),
            h("em", { class: "field_error" })
        ]),
        fieldBox("Проект", selectBox("projectId", editableProjects.map(function (project) {
            return { id: project.id, title: project.name };
        }), task ? task.projectId : defaultProject), "projectId"),
        fieldBox("Приоритет", selectBox("priority", PRIORITIES.map(function (priority) {
            return { id: priority.id, title: priority.title };
        }), task ? task.priority : "medium"), "priority"),
        fieldBox("Статус", selectBox("status", STATUSES.map(function (status) {
            return { id: status.id, title: status.title };
        }), task ? task.status : "todo"), "status"),
        fieldBox("Срок выполнения", textBox("dueDate", task ? task.dueDate : shiftDays(7), "", "date"), "dueDate"),
        fieldBox("Оценка, часов", textBox("estimate", task ? task.estimate : 4, "4", "number"), "estimate"),
        fieldBox("Метки (через запятую)", textBox("tags", task ? task.tags.join(", ") : "", "дизайн, frontend"), "tags"),
        h("div", { class: "field full", data: { field: "dependsOn" } }, [
            h("span", { class: "field-label" }, [
                "Зависит от задач ",
                h("small", { class: "optional-label", text: "необязательно" })
            ]),
            h("p", {
                class: "field-help",
                text: "Оставьте пустым, если эту задачу можно делать независимо от остальных."
            }),
            dependencyPicker(id, values),
            h("em", { class: "field_error" })
        ]),
        h("div", { class: "field full", data: { field: "description" } }, [
            h("span", { text: "Описание" }),
            h("textarea", {
                data: { input: "description" },
                placeholder: "Что нужно сделать и как понять, что задача готова"
            }, [task ? task.description : ""]),
            h("em", { class: "field_error" })
        ])
    ]);

    var foot = [
        h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Отмена",
            on: { click: closeModal }
        })
    ];

    if (task) {
        foot.push(h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Удалить",
            on: {
                click: function () {
                    closeModal();
                    askRemoveTask(task.id);
                }
            }
        }));
    }

    foot.push(h("span", { class: "spacer" }));
    foot.push(h("button", {
        class: "btn btn--primary",
        type: "button",
        text: task ? "Сохранить изменения" : "Создать задачу",
        on: {
            click: function () {
                submitTaskForm(form, values, id);
            }
        }
    }));

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitTaskForm(form, values, id);
    });

    openModal(task ? "Редактирование задачи" : "Новая задача", form, foot);
}

function submitTaskForm(form, values, id) {
    var data = collectTaskValues(form, values);
    var errors = validateTask(data, id);

    if (!errors.status) {
        var probe = { status: data.status, dependsOn: data.dependsOn, title: data.title };
        var check = canMoveTo(probe, data.status);
        if (!check.allowed) {
            errors.status = check.message;
        }
    }

    if (Object.keys(errors).length) {
        setFormErrors(form, errors);
        showToast("warning", "Проверьте форму", "Некоторые поля заполнены неверно.");
        return;
    }

    if (apiMode()) {
        var payload = Object.assign({}, data, { projectId: Number(data.projectId) });
        apiRequest(id ? "/tasks/" + encodeURIComponent(id) : "/tasks", {
            method: id ? "PUT" : "POST",
            body: payload
        }).then(async function () {
            await reloadApiWorkspace();
            closeModal();
            showToast("success", id ? "Задача обновлена" : "Задача создана",
                "«" + data.title + "» " + (id ? "сохранена." : "добавлена в список."));
        }).catch(function (error) {
            showToast("error", "Не удалось сохранить задачу", error.message);
        });
        return;
    }

    if (id) {
        updateTask(id, data);
        showToast("success", "Задача обновлена", "«" + data.title + "» сохранена.");
    } else {
        createTask(data);
        showToast("success", "Задача создана", "«" + data.title + "» добавлена в список.");
    }

    closeModal();
    renderAll();
}

function askRemoveTask(id) {
    var task = taskById(id);
    if (!task) {
        return;
    }
    var dependents = dependentsOf(id);
    var text = "Задача «" + task.title + "» будет удалена без возможности восстановления.";
    if (dependents.length) {
        text += " У " + dependents.length + " задач пропадёт эта зависимость.";
    }
    confirmDialog("Удалить задачу?", text, "Удалить", function () {
        if (apiMode()) {
            apiRequest("/tasks/" + encodeURIComponent(id), { method: "DELETE" })
                .then(reloadApiWorkspace)
                .then(function () {
                    showToast("success", "Задача удалена", "«" + task.title + "» больше не в списке.");
                })
                .catch(function (error) {
                    showToast("error", "Не удалось удалить задачу", error.message);
                });
            return;
        }
        removeTask(id);
        showToast("success", "Задача удалена", "«" + task.title + "» больше не в списке.");
        renderAll();
    });
}

function openTaskDetails(id) {
    var task = taskById(id);
    if (!task) {
        showToast("error", "Задача не найдена", "Возможно, её уже удалили.");
        return;
    }

    var deps = dependenciesOf(task);
    var dependents = dependentsOf(task.id);

    var body = h("div", {}, [
        h("dl", { style: "margin-bottom:16px" }, [
            detailRow("Проект", projectById(task.projectId).name),
            detailRow("Приоритет", priorityById(task.priority).title),
            detailRow("Статус", statusById(task.status).title),
            detailRow("Срок", formatDate(task.dueDate) + (dueHint(task) ? " · " + dueHint(task) : "")),
            detailRow("Оценка", task.estimate ? task.estimate + " ч" : "не указана"),
            detailRow("Метки", task.tags && task.tags.length ? task.tags.join(", ") : "нет"),
            detailRow("Создана", formatDate(task.createdAt)),
            detailRow("Обновлена", formatDate(task.updatedAt))
        ]),
        task.description ? h("p", { style: "margin-bottom:16px", text: task.description }) : null,
        h("p", { class: "card_title", text: "Зависимости" }),
        deps.length ? h("div", { class: "deps", style: "margin-bottom:16px" }, deps.map(function (dep) {
            return h("div", { class: "deps_item" }, [
                h("span", {
                    class: "deps_state " + (dep.status === "done" ? "deps_state--done" : "deps_state--wait")
                }),
                h("span", {
                    class: "task_title",
                    text: dep.title + " · " + statusById(dep.status).title,
                    on: {
                        click: function () {
                            openTaskDetails(dep.id);
                        }
                    }
                })
            ]);
        })) : h("p", { class: "muted", style: "margin-bottom:16px", text: "Задача не зависит от других." }),
        dependents.length ? h("div", {}, [
            h("p", { class: "card_title", text: "От неё зависят" }),
            h("div", { class: "chips", style: "margin-bottom:16px" }, dependents.map(function (item) {
                return h("span", { class: "chip", text: item.title + " · " + statusById(item.status).title });
            }))
        ]) : null,
        blockedAlert(task),
        h("div", { class: "field", style: "margin-top:16px" }, [
            h("span", { text: "Изменить статус" }),
            statusSelect(task)
        ])
    ]);

    var footer = [];
    if (canEditProject(task.projectId)) {
        footer.push(h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Изменить",
            on: {
                click: function () {
                    closeModal();
                    openTaskForm(task.id);
                }
            }
        }));
        footer.push(h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Удалить",
            on: {
                click: function () {
                    closeModal();
                    askRemoveTask(task.id);
                }
            }
        }));
    }
    footer.push(h("span", { class: "spacer" }));
    footer.push(h("button", {
            class: "btn btn--primary",
            type: "button",
            text: "Закрыть",
            on: { click: closeModal }
        }));
    openModal("Задача", body, footer);
}

function detailRow(label, value) {
    return h("div", { class: "detail-row" }, [
        h("dt", { text: label }),
        h("dd", { text: value })
    ]);
}

function openProjectActions(project) {
    var taskCount = state.tasks.filter(function (task) {
        return task.projectId === project.id;
    }).length;
    openModal(project.name, h("p", {
        text: "В проекте задач: " + taskCount + ". Выберите действие."
    }), [
        h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Отмена",
            on: { click: closeModal }
        }),
        h("span", { class: "spacer" }),
        h("button", {
            class: "btn btn--ghost project-action-delete",
            type: "button",
            text: "Удалить",
            on: {
                click: function () {
                    closeModal();
                    askRemoveProject(project);
                }
            }
        }),
        h("button", {
            class: "btn btn--primary",
            type: "button",
            text: "Изменить",
            on: {
                click: function () {
                    closeModal();
                    openProjectForm(project.id);
                }
            }
        })
    ]);
}

function askRemoveProject(project) {
    var taskCount = state.tasks.filter(function (task) {
        return task.projectId === project.id;
    }).length;
    var projectNameInput = h("input", {
        type: "text",
        placeholder: project.name,
        autocomplete: "off",
        "aria-label": "Название проекта для подтверждения удаления"
    });
    var deleteButton = h("button", {
        class: "btn btn--primary project-action-delete",
        type: "button",
        text: "Продолжить",
        disabled: "disabled"
    });
    var message = "Чтобы продолжить, введите название проекта точно так, как оно указано: «" + project.name + "».";
    if (taskCount) {
        message += " Вместе с проектом будут удалены все его задачи (" + taskCount + ").";
    }
    var body = h("div", { class: "project-delete-confirm" }, [
        h("p", { text: message }),
        h("label", { class: "field" }, [
            h("span", { text: "Название проекта" }),
            projectNameInput
        ]),
        h("p", {
            class: "field-help",
            text: "Участники и приглашения этого проекта также будут удалены."
        })
    ]);
    projectNameInput.addEventListener("input", function () {
        deleteButton.disabled = projectNameInput.value.trim() !== project.name;
    });
    deleteButton.addEventListener("click", function () {
        closeModal();
        confirmProjectDeletePassword(project);
    });
    openModal("Подтвердите удаление проекта", body, [
        h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Отмена",
            on: { click: closeModal }
        }),
        h("span", { class: "spacer" }),
        deleteButton
    ]);
}

function confirmProjectDeletePassword(project) {
    if (!apiMode()) {
        showToast("error", "Нужно войти через сервер", "Проверка пароля доступна после запуска приложения через npm start.");
        return;
    }
    var passwordInput = h("input", {
        type: "password",
        autocomplete: "current-password",
        placeholder: "Текущий пароль",
        required: "required"
    });
    var error = h("em", { class: "field_error", text: "" });
    var confirmButton = h("button", {
        class: "btn btn--primary project-action-delete",
        type: "button",
        text: "Удалить проект",
        on: {
            click: async function () {
                if (!passwordInput.value) {
                    error.textContent = "Введите пароль.";
                    passwordInput.focus();
                    return;
                }
                confirmButton.disabled = true;
                error.textContent = "";
                try {
                    await apiRequest("/projects/" + encodeURIComponent(project.id), {
                        method: "DELETE",
                        body: { password: passwordInput.value }
                    });
                    closeModal();
                    showToast("success", "Проект удалён", "«" + project.name + "» и его данные удалены.");
                    reloadApiWorkspace().catch(function (reloadError) {
                        showToast("error", "Проект удалён, но список не обновлён", reloadError.message);
                    });
                } catch (requestError) {
                    error.textContent = requestError.message;
                    confirmButton.disabled = false;
                    passwordInput.focus();
                }
            }
        }
    });
    var passwordForm = h("form", { class: "project-delete-confirm", novalidate: "novalidate" }, [
        h("p", { text: "Для окончательного удаления проекта «" + project.name + "» введите пароль от аккаунта." }),
        h("label", { class: "field" }, [
            h("span", { text: "Пароль аккаунта" }),
            passwordInput,
            error
        ])
    ]);
    passwordForm.addEventListener("submit", function (event) {
        event.preventDefault();
        confirmButton.click();
    });
    openModal("Подтвердите пароль", passwordForm, [
        h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Отмена",
            on: { click: closeModal }
        }),
        h("span", { class: "spacer" }),
        confirmButton
    ]);
}

function openProjectForm(projectId) {
    var project = projectId ? state.projects.find(function (item) {
        return item.id === projectId;
    }) : null;
    var selectedColor = project ? project.color : PROJECT_COLORS[0];
    var selectedIndex = PROJECT_COLORS.indexOf(selectedColor.toLowerCase());
    var selectedLabel = selectedIndex === -1 ? "Свой цвет" : "Цвет " + (selectedIndex + 1);
    var name = h("input", {
        type: "text",
        placeholder: "Название проекта",
        maxlength: "80",
        value: project ? project.name : ""
    });
    var colorPicker = h("div", { class: "project-color-picker" });
    var colorMenu = h("div", { class: "project-color-menu", hidden: "hidden" });
    var selectedSwatch = h("span", {
        class: "project-color-swatch",
        style: "background-color:" + selectedColor
    });
    var selectedText = h("span", { text: selectedLabel });
    var colorTrigger = h("button", {
        class: "project-color-trigger",
        type: "button",
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
        on: {
            click: function () {
                colorMenu.hidden = !colorMenu.hidden;
                colorTrigger.setAttribute("aria-expanded", colorMenu.hidden ? "false" : "true");
            }
        }
    }, [
        selectedSwatch,
        selectedText,
        h("span", { class: "project-color-chevron", "aria-hidden": "true" })
    ]);

    function updateSelectedColor(color, label) {
        selectedColor = color;
        selectedLabel = label;
        selectedSwatch.style.backgroundColor = color;
        selectedText.textContent = label;
        colorMenu.querySelectorAll('[role="option"]').forEach(function (option) {
            option.setAttribute("aria-selected",
                label !== "Свой цвет" && option.dataset.color === color ? "true" : "false");
        });
        colorMenu.hidden = true;
        colorTrigger.setAttribute("aria-expanded", "false");
    }

    PROJECT_COLORS.forEach(function (value, index) {
        var label = "Цвет " + (index + 1);
        colorMenu.appendChild(h("button", {
            class: "project-color-option",
            type: "button",
            role: "option",
            data: { color: value },
            "aria-selected": value === selectedColor ? "true" : "false",
            on: {
                click: function () {
                    updateSelectedColor(value, label);
                }
            }
        }, [
            h("span", { class: "project-color-swatch", style: "background-color:" + value }),
            h("span", { text: label })
        ]));
    });

    var customColorInput = h("input", {
        class: "project-color-input",
        type: "color",
        value: selectedColor,
        "aria-label": "Палитра собственного цвета",
        on: {
            input: function () {
                updateSelectedColor(this.value, "Свой цвет");
            },
            change: function () {
                updateSelectedColor(this.value, "Свой цвет");
            }
        }
    });
    colorMenu.appendChild(h("button", {
        class: "project-color-option",
        type: "button",
        role: "option",
        on: {
            click: function () {
                colorMenu.hidden = true;
                colorTrigger.setAttribute("aria-expanded", "false");
                customColorInput.click();
            }
        }
    }, [
        h("span", {
            class: "project-color-swatch project-color-rainbow",
            "aria-hidden": "true"
        }),
        h("span", { text: "Свой цвет..." })
    ]));

    colorPicker.appendChild(colorTrigger);
    colorPicker.appendChild(colorMenu);
    colorPicker.appendChild(customColorInput);

    var body = h("div", { class: "field" }, [
        h("span", { text: "Название" }),
        name,
        h("em", { class: "field_error", text: "" }),
        h("span", { text: "Цвет проекта", style: "margin-top:10px" }),
        colorPicker
    ]);

    openModal(project ? "Редактировать проект" : "Новый проект", body, [
        h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Отмена",
            on: { click: closeModal }
        }),
        h("span", { class: "spacer" }),
        h("button", {
            class: "btn btn--primary",
            type: "button",
            text: project ? "Сохранить изменения" : "Создать проект",
            on: {
                click: function () {
                    var title = name.value.trim();
                    var error = body.querySelector(".field_error");
                    if (title.length < 2) {
                        error.textContent = "Название не короче двух символов";
                        name.focus();
                        return;
                    }
                    var exists = state.projects.some(function (item) {
                        return item.id !== projectId && item.name.toLowerCase() === title.toLowerCase();
                    });
                    if (exists) {
                        error.textContent = "Такой проект уже есть";
                        return;
                    }
                    if (apiMode()) {
                        apiRequest(project ? "/projects/" + encodeURIComponent(project.id) : "/projects", {
                            method: project ? "PATCH" : "POST",
                            body: { name: title, color: selectedColor }
                        }).then(async function (result) {
                            await reloadApiWorkspace();
                            if (!project) {
                                state.project = String(result.project.id);
                                renderAll();
                            }
                            closeModal();
                            showToast("success", project ? "Проект обновлён" : "Проект создан",
                                "«" + title + "» " + (project ? "сохранён." : "добавлен в список."));
                        }).catch(function (requestError) {
                            error.textContent = requestError.message;
                        });
                        return;
                    }
                    if (project) {
                        updateProject(project.id, title, selectedColor);
                        closeModal();
                        renderAll();
                        showToast("success", "Проект обновлён", "Изменения проекта «" + title + "» сохранены.");
                        return;
                    }
                    var createdProject = createProject(title, selectedColor);
                    state.project = createdProject.id;
                    closeModal();
                    showToast("success", "Проект создан", "«" + createdProject.name + "» добавлен в список.");
                    renderAll();
                }
            }
        })
    ]);
}
function initialsFrom(name) {
    var parts = String(name).trim().split(/\s+/);
    var first = parts[0] ? parts[0].charAt(0) : "";
    var second = parts[1] ? parts[1].charAt(0) : "";
    var result = (first + second).toUpperCase();
    return result || "МП";
}

function switchAuthTab(mode) {
    var login = mode === "login";
    var incomingForm = $(login ? "loginForm" : "registerForm");
    var outgoingForm = $(login ? "registerForm" : "loginForm");
    $("tabLogin").classList.toggle("is-active", login);
    $("tabRegister").classList.toggle("is-active", !login);
    outgoingForm.hidden = true;
    incomingForm.hidden = false;
    incomingForm.classList.remove("auth-form-enter");
    void incomingForm.offsetWidth;
    incomingForm.classList.add("auth-form-enter");
    incomingForm.addEventListener("animationend", function onAuthFormEnter(event) {
        if (event.target === incomingForm) {
            incomingForm.classList.remove("auth-form-enter");
            incomingForm.removeEventListener("animationend", onAuthFormEnter);
        }
    });
    clearAuthMessages();
}

function clearAuthMessages() {
    ["loginForm", "registerForm"].forEach(function (id) {
        var form = $(id);
        if (!form) {
            return;
        }
        setFormErrors(form, {});
        var box = form.querySelector(".form-error");
        if (box) {
            box.hidden = true;
            box.textContent = "";
        }
    });
}

function showAuthError(formId, message) {
    var box = $(formId).querySelector(".form-error");
    if (!box) {
        return;
    }
    box.textContent = message;
    box.hidden = false;
}

function startSession(user, note, token) {
    state.user = Object.assign({}, user, {
        role: user.role || "Участник проекта",
        initials: user.initials || initialsFrom(user.name)
    });
    if (token) {
        try {
            window.localStorage.setItem(API_TOKEN_KEY, token);
        } catch (error) {
            showToast("error", "Сессия не сохранена", "Разрешите сайту хранить данные в браузере и войдите снова.");
            return;
        }
    }
    var isApiSession = serverApp() && Boolean(token || storedApiToken());
    state.projects = isApiSession ? [] : demoProjects();
    state.tasks = isApiSession ? [] : demoTasks();
    state.invitations = [];

    var storageData = null;
    try {
        storageData = JSON.parse(window.localStorage.getItem(userStorageKey(state.user.email)) || "null");
    } catch (error) {
        storageData = null;
    }

    if (!isApiSession && storageData && storageData.projects && storageData.tasks) {
        state.projects = storageData.projects;
        state.tasks = storageData.tasks;
    }

    saveState();
    clearAuthMessages();
    showAppScreen();
    showToast("success", "Добро пожаловать, " + state.user.name.split(" ")[0], note);
    if (isApiSession) {
        reloadApiWorkspace().catch(function (error) {
            showToast("error", "Не удалось загрузить проекты", error.message);
        });
    }
}

function showAppScreen() {
    $("authScreen").hidden = true;
    $("appScreen").hidden = false;
    renderAll();
}

function showAuthScreen() {
    $("appScreen").hidden = true;
    $("authScreen").hidden = false;
}

function submitLogin(event) {
    event.preventDefault();
    var form = $("loginForm");
    var values = {
        email: form.querySelector('[name="email"]').value.trim(),
        password: form.querySelector('[name="password"]').value
    };
    var errors = validateLogin(values);
    setFormErrors(form, errors);

    if (Object.keys(errors).length) {
        showAuthError("loginForm", "Проверьте выделенные поля.");
        return;
    }

    var email = normalizeUserEmail(values.email);
    if (serverApp()) {
        apiRequest("/auth/login", {
            method: "POST",
            body: { email: email, password: values.password }
        }).then(function (result) {
            startSession(result.user, "Вы вошли в аккаунт.", result.token);
        }).catch(function (error) {
            showAuthError("loginForm", error.message);
        });
        return;
    }

    if (email !== DEMO_EMAIL || values.password !== DEMO_PASSWORD) {
        var storedUser = null;
        try {
            storedUser = JSON.parse(window.localStorage.getItem(userStorageKey(email)) || "null");
        } catch (error) {
            storedUser = null;
        }

        if (!storedUser || !storedUser.user) {
            showAuthError("loginForm", "Неверный адрес или пароль. Зарегистрируйтесь.");
            return;
        }

        state.user = storedUser.user;
        state.projects = storedUser.projects || demoProjects();
        state.tasks = storedUser.tasks || demoTasks();
        saveState();
        clearAuthMessages();
        showAppScreen();
        showToast("success", "Добро пожаловать, " + state.user.name.split(" ")[0], "Вы вошли в личный кабинет.");
        return;
    }

    startSession(demoUser(), "Вы вошли в профиль.");
}

function submitRegister(event) {
    event.preventDefault();
    var form = $("registerForm");
    var values = {
        name: form.querySelector('[name="name"]').value.trim(),
        email: form.querySelector('[name="email"]').value.trim(),
        password: form.querySelector('[name="password"]').value,
        password2: form.querySelector('[name="password2"]').value
    };
    var errors = validateRegister(values);

    var normalizedEmail = normalizeUserEmail(values.email);
    if (!serverApp()) {
        if (normalizedEmail && normalizedEmail === DEMO_EMAIL) {
            errors.email = "Этот адрес занят демо-профилем";
        }

        try {
            var existing = JSON.parse(window.localStorage.getItem(userStorageKey(normalizedEmail)) || "null");
            if (existing && existing.user) {
                errors.email = "Уже есть аккаунт с таким адресом";
            }
        } catch (error) {
            // Local demo accounts may not be available when browser storage is blocked.
        }
    }

    setFormErrors(form, errors);

    if (Object.keys(errors).length) {
        showAuthError("registerForm", "Проверьте выделенные поля.");
        return;
    }

    if (serverApp()) {
        apiRequest("/auth/register", {
            method: "POST",
            body: { name: values.name, email: normalizedEmail, password: values.password }
        }).then(function (result) {
            startSession(result.user, "Аккаунт создан.", result.token);
        }).catch(function (error) {
            showAuthError("registerForm", error.message);
        });
        return;
    }

    var user = {
        id: "user-" + normalizedEmail.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name: values.name,
        email: normalizedEmail,
        role: "",
        initials: initialsFrom(values.name)
    };

    var freshProjects = demoProjects();
    var freshTasks = demoTasks();
    var userData = {
        user: user,
        projects: freshProjects,
        tasks: freshTasks
    };

    try {
        window.localStorage.setItem(userStorageKey(user.email), JSON.stringify(userData));
    } catch (error) {
        showAuthError("registerForm", "Не удалось создать аккаунт.");
        return;
    }

    startSession(user, "Аккаунт создан.");
}

function logout() {
    var token = storedApiToken();
    if (token && serverApp()) {
        apiRequest("/auth/logout", { method: "POST" }).catch(function (error) {
            showToast("error", "Не удалось завершить сессию на сервере", error.message);
        }).finally(finishLogout);
        return;
    }
    finishLogout();
}

function finishLogout() {
    try {
        window.localStorage.removeItem(API_TOKEN_KEY);
    } catch (error) {
        showToast("error", "Сессия не очищена", "Браузер запретил удалить токен авторизации.");
    }
    state.user = null;
    saveState();
    closeModal();
    showAuthScreen();
    showToast("success", "Вы вышли из профиля", "Локальные данные сохранены.");
}

function bindAuth() {
    var loginTab = $("tabLogin");
    var registerTab = $("tabRegister");
    var loginForm = $("loginForm");
    var registerForm = $("registerForm");

    if (loginTab) {
        loginTab.addEventListener("click", function () {
            switchAuthTab("login");
        });
    }
    if (registerTab) {
        registerTab.addEventListener("click", function () {
            switchAuthTab("register");
        });
    }
    if (loginForm) {
        loginForm.addEventListener("submit", submitLogin);
    }
    if (registerForm) {
        registerForm.addEventListener("submit", submitRegister);
    }
}

function debounce(fn, delay) {
    var timer = null;
    return function () {
        var args = arguments;
        window.clearTimeout(timer);
        timer = window.setTimeout(function () {
            fn.apply(null, args);
        }, delay);
    };
}

function openProfileModal() {
    if (!state.user) return;

    var profileForm = h("form", { class: "profile_form", novalidate: "novalidate" });
    var nameInput = textBox("profileName", state.user.name, "Ваше имя");
    nameInput.maxLength = 100;
    var imageInput = h("input", {
        type: "file",
        accept: "image/png,image/jpeg,image/webp"
    });
    var preview = h("div", { class: "profile_avatar-preview" });
    var previewUrl = "";

    function renderPreview(source) {
        clear(preview);
        if (source) {
            preview.appendChild(h("img", {
                src: source,
                alt: "Аватар профиля"
            }));
        } else {
            preview.appendChild(h("span", { text: initialsFrom(nameInput.value) }));
        }
    }
    renderPreview(state.user.avatarUrl);
    nameInput.addEventListener("input", function () {
        if (!state.user.avatarUrl && !imageInput.files.length) {
            renderPreview("");
        }
    });
    imageInput.addEventListener("change", function () {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = imageInput.files.length ? URL.createObjectURL(imageInput.files[0]) : "";
        renderPreview(previewUrl || state.user.avatarUrl);
    });

    var profileNotice = h("p", {
        class: "field-help",
        text: state.user.emailVerified === false ? "Адрес электронной почты не подтверждён."
            : "Адрес электронной почты подтверждён."
    });
    var profileFields = h("div", { class: "profile_avatar-row" }, [
        preview,
        h("label", { class: "btn btn--ghost btn--small profile_upload" }, [
            "Выбрать фото",
            imageInput
        ]),
        h("span", { class: "muted profile_file-hint", text: "PNG, JPEG или WebP, до 2 МБ" })
    ]);
    if (state.user.avatarUrl) {
        profileFields.appendChild(h("button", {
            class: "btn btn--ghost btn--small",
            type: "button",
            text: "Удалить фото",
            on: {
                click: async function () {
                    try {
                        await apiRequest("/auth/avatar", { method: "DELETE" });
                        state.user.avatarUrl = null;
                        saveState();
                        renderAll();
                        showToast("success", "Фото удалено", "Вместо фото будут показаны инициалы.");
                        openProfileModal();
                    } catch (error) {
                        showToast("error", "Не удалось удалить фото", error.message);
                    }
                }
            }
        }));
    }
    profileForm.appendChild(profileFields);
    profileForm.appendChild(fieldBox("Имя", nameInput, "name"));
    profileForm.appendChild(h("p", { class: "profile_email", text: state.user.email }));
    profileForm.appendChild(profileNotice);

    var passwordForm = h("form", { class: "profile_password", novalidate: "novalidate" }, [
        h("h4", { text: "Безопасность" }),
        h("p", { class: "muted", text: "Смена пароля завершит остальные активные сессии." }),
        fieldBox("Текущий пароль", h("input", {
            type: "password",
            autocomplete: "current-password",
            required: "required"
        }), "currentPassword"),
        fieldBox("Новый пароль", h("input", {
            type: "password",
            autocomplete: "new-password",
            minlength: "8",
            required: "required"
        }), "newPassword"),
        fieldBox("Повторите новый пароль", h("input", {
            type: "password",
            autocomplete: "new-password",
            minlength: "8",
            required: "required"
        }), "confirmPassword"),
        h("button", {
            class: "btn btn--ghost",
            type: "submit",
            text: "Изменить пароль"
        })
    ]);

    profileForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var token = storedApiToken();
        if (!serverApp() || !token) {
            showToast("error", "Нет серверной сессии", "Войдите через приложение, запущенное командой npm start.");
            return;
        }
        if (nameInput.value.trim().length < 2) {
            showToast("error", "Проверьте имя", "Имя должно содержать не менее двух символов.");
            return;
        }

        var saveButton = $("modalFoot").querySelector('[data-action="save-profile"]');
        if (saveButton) saveButton.disabled = true;
        try {
            var result = await apiRequest("/auth/profile", {
                method: "PATCH",
                body: { name: nameInput.value.trim() }
            });
            state.user = Object.assign({}, state.user, result.user, {
                role: state.user.role,
                initials: initialsFrom(result.user.name)
            });

            if (imageInput.files.length) {
                var formData = new FormData();
                formData.append("avatar", imageInput.files[0]);
                var avatarResult = await apiRequest("/auth/avatar", {
                    method: "POST",
                    body: formData
                });
                state.user.avatarUrl = avatarResult.avatarUrl;
            }

            saveState();
            renderAll();
            showToast("success", "Профиль обновлён", "Имя и изображение сохранены.");
            openProfileModal();
        } catch (error) {
            showToast("error", "Не удалось сохранить профиль", error.message);
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    });

    passwordForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        var fields = passwordForm.querySelectorAll('input[type="password"]');
        var currentPassword = fields[0].value;
        var newPassword = fields[1].value;
        var confirmation = fields[2].value;
        if (newPassword.length < 8 || newPassword !== confirmation) {
            showToast("error", "Проверьте новый пароль", newPassword.length < 8
                ? "Пароль должен содержать не менее 8 символов."
                : "Пароли не совпадают.");
            return;
        }

        try {
            var result = await apiRequest("/auth/password", {
                method: "POST",
                body: { currentPassword: currentPassword, newPassword: newPassword }
            });
            passwordForm.reset();
            showToast("success", "Пароль изменён", result.message);
        } catch (error) {
            showToast("error", "Не удалось изменить пароль", error.message);
        }
    });

    var footer = [
        h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Закрыть",
            on: {
                click: function () {
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    closeModal();
                }
            }
        }),
        h("span", { class: "spacer" }),
        h("button", {
            class: "btn btn--primary",
            type: "submit",
            text: "Сохранить профиль",
            "data-action": "save-profile",
            on: {
                click: function () {
                    profileForm.requestSubmit();
                }
            }
        })
    ];
    openModal("Профиль", h("div", {}, [
        profileForm,
        passwordForm
    ]), footer);

    $("modal").addEventListener("modalclose", function () {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, { once: true });
}

function restoreApiSession() {
    var token = storedApiToken();
    if (!serverApp() || !token) return;
    apiRequest("/auth/me", { token: token }).then(function (result) {
        state.user = Object.assign({}, result.user, {
            role: "Участник проекта",
            initials: initialsFrom(result.user.name)
        });
        state.projects = [];
        state.tasks = [];
        state.invitations = [];
        showAppScreen();
        reloadApiWorkspace().catch(function (workspaceError) {
            showToast("error", "Не удалось загрузить проекты", workspaceError.message);
        });
    }).catch(function (error) {
        if (error.status === 401) {
            try {
                window.localStorage.removeItem(API_TOKEN_KEY);
            } catch (storageError) {
                showToast("error", "Не удалось очистить сессию", "Удалите данные сайта в настройках браузера.");
            }
        }
        showAuthScreen();
        showToast("error", "Не удалось восстановить сессию", error.message);
    });
}

function bindApp() {
    var newTaskBtn = $("newTaskBtn");
    var sharingBtn = $("sharingBtn");
    var notificationsBtn = $("notificationsBtn");
    var searchInput = $("searchInput");
    var mainNav = $("mainNav");
    var resetDemoBtn = $("resetDemo");
    var logoutBtn = $("logoutBtn");
    var profileBtn = $("profileBtn");
    var homeBtn = $("homeBtn");
    var modal = $("modal");

    if (newTaskBtn) {
        newTaskBtn.addEventListener("click", function () {
            openTaskForm(null);
        });
    }
    if (sharingBtn) {
        sharingBtn.addEventListener("click", openProjectSharing);
    }
    if (notificationsBtn) {
        notificationsBtn.addEventListener("click", openInvitationsModal);
    }

    if (searchInput) {
        searchInput.value = state.search;
        searchInput.addEventListener("input", debounce(function (event) {
            state.search = event.target.value;
            renderView();
        }, 220));
    }

    if (mainNav) {
        mainNav.addEventListener("click", function (event) {
            var button = event.target.closest("[data-view]");
            if (!button) {
                return;
            }
            state.view = button.dataset.view;
            renderView();
            syncMainNavigation();
        });
    }

    if (homeBtn) {
        homeBtn.addEventListener("click", function () {
            state.view = "overview";
            state.project = "all";
            renderAll();
        });
    }

    if (resetDemoBtn) {
        resetDemoBtn.addEventListener("click", function () {
            confirmDialog(
                "Сбросить демо-данные?",
                "Все изменения будут потеряны, вернутся исходные задачи и проекты.",
                "Сбросить",
                function () {
                    resetDemoData();
                    state.view = "overview";
                    state.project = "all";
                    clearFilters();
                    renderAll();
                    showToast("success", "Демо-данные восстановлены", "Загружен исходный набор задач.");
                }
            );
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", logout);
    }
    if (profileBtn) {
        profileBtn.addEventListener("click", openProfileModal);
    }

    if (modal) {
        modal.addEventListener("click", function (event) {
            if (event.target.dataset.close === "modal") {
                closeModal();
            }
        });
    }

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && $("modal") && !$("modal").hidden) {
            closeModal();
        }
    });
}

function bindGlobalErrors() {
    window.addEventListener("error", function () {
        showToast("error", "Непредвиденная ошибка", "Попробуйте обновить страницу. Если проблема повторится, обратитесь в поддержку.");
    });

    window.addEventListener("unhandledrejection", function () {
        showToast("error", "Операция не завершилась", "Повторите действие ещё раз.");
    });
}

function init() {
    loadState();
    bindGlobalErrors();
    bindAuth();
    bindApp();

    if (serverApp()) {
        if (storedApiToken()) {
            showAuthScreen();
            restoreApiSession();
        } else {
            showAuthScreen();
        }
    } else if (state.user) {
        $("userName").textContent = state.user.name;
        showAppScreen();
    } else {
        showAuthScreen();
    }
}

document.addEventListener("DOMContentLoaded", init);
