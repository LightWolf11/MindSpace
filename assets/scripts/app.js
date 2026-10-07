"use strict";

var PROJECT_COLORS = ["#5c1f2d", "#c98b7f", "#b0904a", "#7d5a6b", "#8b5a3c"];

function fieldBox(label, control, key) {
    return h("label", { class: "field", data: { field: key } }, [
        h("span", { text: label }),
        control,
        h("em", { class: "field__error" })
    ]);
}

function setFormErrors(form, errors) {
    form.querySelectorAll("[data-field]").forEach(function (box) {
        var key = box.dataset.field;
        var message = errors[key] || "";
        var output = box.querySelector(".field__error");
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
    return h("div", {}, [search, list]);
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
    var defaultProject = state.project !== "all"
        ? state.project
        : (state.projects[0] ? state.projects[0].id : "");

    var form = h("form", { class: "form-grid", novalidate: "novalidate" }, [
        h("div", { class: "field full", data: { field: "title" } }, [
            h("span", { text: "Название задачи" }),
            textBox("title", task ? task.title : "", "Например: собрать макет экрана"),
            h("em", { class: "field__error" })
        ]),
        fieldBox("Проект", selectBox("projectId", state.projects.map(function (project) {
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
            h("span", { text: "Зависит от задач" }),
            dependencyPicker(id, values),
            h("em", { class: "field__error" })
        ]),
        h("div", { class: "field full", data: { field: "description" } }, [
            h("span", { text: "Описание" }),
            h("textarea", {
                data: { input: "description" },
                placeholder: "Что нужно сделать и как понять, что задача готова"
            }, [task ? task.description : ""]),
            h("em", { class: "field__error" })
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
        h("p", { class: "card__title", text: "Зависимости" }),
        deps.length ? h("div", { class: "deps", style: "margin-bottom:16px" }, deps.map(function (dep) {
            return h("div", { class: "deps__item" }, [
                h("span", {
                    class: "deps__state " + (dep.status === "done" ? "deps__state--done" : "deps__state--wait")
                }),
                h("span", {
                    class: "task__title",
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
            h("p", { class: "card__title", text: "От неё зависят" }),
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

    openModal("Задача", body, [
        h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Изменить",
            on: {
                click: function () {
                    closeModal();
                    openTaskForm(task.id);
                }
            }
        }),
        h("button", {
            class: "btn btn--ghost",
            type: "button",
            text: "Удалить",
            on: {
                click: function () {
                    closeModal();
                    askRemoveTask(task.id);
                }
            }
        }),
        h("span", { class: "spacer" }),
        h("button", {
            class: "btn btn--primary",
            type: "button",
            text: "Закрыть",
            on: { click: closeModal }
        })
    ]);
}

function detailRow(label, value) {
    return h("div", { class: "detail-row" }, [
        h("dt", { text: label }),
        h("dd", { text: value })
    ]);
}

function openProjectForm() {
    var name = h("input", { type: "text", placeholder: "Название проекта" });
    var color = h("select", {}, PROJECT_COLORS.map(function (value, index) {
        return h("option", { value: value, text: "Цвет " + (index + 1) });
    }));

    var body = h("div", { class: "field" }, [
        h("span", { text: "Название" }),
        name,
        h("em", { class: "field__error", text: "" }),
        h("span", { text: "Цвет метки", style: "margin-top:10px" }),
        color
    ]);

    openModal("Новый проект", body, [
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
            text: "Создать проект",
            on: {
                click: function () {
                    var title = name.value.trim();
                    var error = body.querySelector(".field__error");
                    if (title.length < 2) {
                        error.textContent = "Название не короче двух символов";
                        name.focus();
                        return;
                    }
                    var exists = state.projects.some(function (project) {
                        return project.name.toLowerCase() === title.toLowerCase();
                    });
                    if (exists) {
                        error.textContent = "Такой проект уже есть";
                        return;
                    }
                    var project = createProject(title, color.value);
                    state.project = project.id;
                    closeModal();
                    showToast("success", "Проект создан", "«" + project.name + "» добавлен в список.");
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
    $("tabLogin").classList.toggle("is-active", login);
    $("tabRegister").classList.toggle("is-active", !login);
    $("loginForm").hidden = !login;
    $("registerForm").hidden = login;
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

function startSession(user, note) {
    state.user = user;
    state.projects = demoProjects();
    state.tasks = demoTasks();

    var storageData = null;
    try {
        storageData = JSON.parse(window.localStorage.getItem(userStorageKey(user.email)) || "null");
    } catch (error) {
        storageData = null;
    }

    if (storageData && storageData.projects && storageData.tasks) {
        state.projects = storageData.projects;
        state.tasks = storageData.tasks;
    }

    saveState();
    clearAuthMessages();
    showAppScreen();
    showToast("success", "Добро пожаловать, " + user.name.split(" ")[0], note);
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
    if (email !== DEMO_EMAIL || values.password !== DEMO_PASSWORD) {
        var storedUser = null;
        try {
            storedUser = JSON.parse(window.localStorage.getItem(userStorageKey(email)) || "null");
        } catch (error) {
            storedUser = null;
        }

        if (!storedUser || !storedUser.user) {
            showAuthError("loginForm", "Неверный адрес или пароль. Воспользуйтесь демо-доступом или зарегистрируйтесь.");
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

    startSession(demoUser(), "Вы вошли в демонстрационный профиль.");
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
    if (normalizedEmail && normalizedEmail === DEMO_EMAIL) {
        errors.email = "Этот адрес занят демо-профилем";
    }

    try {
        var existing = JSON.parse(window.localStorage.getItem(userStorageKey(normalizedEmail)) || "null");
        if (existing && existing.user) {
            errors.email = "Уже есть аккаунт с таким адресом";
        }
    } catch (error) {
        // ignore
    }

    setFormErrors(form, errors);

    if (Object.keys(errors).length) {
        showAuthError("registerForm", "Проверьте выделенные поля.");
        return;
    }

    var user = {
        id: "user-" + normalizedEmail.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        name: values.name,
        email: normalizedEmail,
        role: "Участник проекта",
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
    state.user = null;
    saveState();
    closeModal();
    showAuthScreen();
    showToast("success", "Вы вышли из профиля", "Данные сохранены в cookie.");
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

function bindApp() {
    var newTaskBtn = $("newTaskBtn");
    var searchInput = $("searchInput");
    var mainNav = $("mainNav");
    var resetDemoBtn = $("resetDemo");
    var logoutBtn = $("logoutBtn");
    var modal = $("modal");

    if (newTaskBtn) {
        newTaskBtn.addEventListener("click", function () {
            openTaskForm(null);
        });
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
            document.querySelectorAll("#mainNav .nav__item").forEach(function (item) {
                item.classList.toggle("is-active", item.dataset.view === state.view);
            });
            renderView();
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
    window.addEventListener("error", function (event) {
        showToast("error", "Непредвиденная ошибка", event.message || "Подробности в консоли браузера.");
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

    if (state.user) {
        $("userName").textContent = state.user.name;
        showAppScreen();
    } else {
        showAuthScreen();
    }
}

document.addEventListener("DOMContentLoaded", init);
