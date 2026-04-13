plugins {
    id("java")
    id("maven-publish")
    id("distribution")
}

group = "io.naviam"
version = "1.0.0"


val vendor = "Naviam"
val product = "autoscript-debug"
val distro = "autoscript-debug"



val azureToken: String by project


repositories {
    mavenCentral()

    /**
     *  https://mvn.naviam.dev is Naviam's Maven repository that hosts Maximo dependencies in a private repository.
     *
     *  To create a token login to Azure DevOps (https://dev.azure.com/naviamio), then click the person icon with a gear that is next to the user avatar
     *  in the top right of the screen, then select the Personal access token menu item. Click the + New Token button, provide a name, such as "Naviam Maven",
     *  set an expiration time (the maximum is 365 days), then under the Packaging scope select the Read option, finally click the Create button.  Copy the token
     *  for use in the gradle.properties file.
     *
     *  An access token is required access the private repository. The token is configured in the
     *  $HOME/.gradle/gradle.properties file. The gradle.properties file should be only visible to the current user and should not be readable by other users on the system.
     *
     *  On a macOS or Linux system you can run the following command to set the correct permissions: chmod go-rw ~/.gradle/gradle.properties
     *
     *  On Windows open a command prompt (Windows key + cmd) then run icacls "C:\Users\%USERNAME%\.gradle\gradle.properties" /inheritance:r then execute icacls "C:\Users\%USERNAME%\.gradle\gradle.properties" /grant "%USERNAME%":(R)
     *
     *  Add the following line to gradle.properties where <token> is your Azure DevOps token.
     *  azureToken=<token>
     *
     *  If not a member of the Naviam development team, either update this with your own repository or remove and uncomment the
     *  appropriate dependencies for local library dependencies that can be placed in the lib folder.
     *
     */
    maven {
        name = "azure"
        url = uri("https://mvn.naviam.dev/internal/maven/v1")
        credentials {
            username = "naviamio"
            password = azureToken
        }
    }
}

java {
    // Set Java 17 compatibility for both source and target, ensuring the JDBC driver can work with older tooling.
    toolchain { languageVersion.set(JavaLanguageVersion.of(17)) }
    withSourcesJar()
    withJavadocJar()
}

distributions {

    @Suppress("unused")
    val distribution by configurations.creating {
        extendsFrom(configurations.implementation.get())
        isCanBeResolved = true
    }

    main {
        contents {
            into("applications/maximo/lib") {
                from("${layout.buildDirectory.asFile.get().path}/libs/${product.lowercase()}.jar")
            }

            into("tools/maximo/classes") {
                includeEmptyDirs = false
                from(layout.buildDirectory.dir("classes/java/main")) {
                    include("psdi/autoscriptdebug/en/*.class")
                }
            }
        }
    }
}

// Configure the distribution task to tar and gzip the results.
tasks.distTar {
    rootSpec
    compression = Compression.GZIP
    archiveExtension.set("tar.gz")
}


tasks.assembleDist {
    finalizedBy("fixzip")
}

tasks.register("fixzip"){
    dependsOn("rezip", "retar")

    doLast{
        delete(layout.buildDirectory.asFile.get().path + File.separator + "distributions" + File.separator + "tmp")
    }

}

tasks.register("unzip") {
    val distDir = layout.buildDirectory.asFile.get().path + File.separator + "distributions"

    doLast {
        copy {
            from(zipTree(tasks.distZip.get().archiveFile.get().asFile))
            into(distDir + File.separator + "tmp")
        }
        copy {
            into(distDir + File.separator + "tmp/${project.name}-${version}/tools/maximo/classes")
        }
    }
}

tasks.register<Zip>("rezip"){
    dependsOn("unzip")
    val archiveBaseName = project.name + "-" + project.version
    val distDir = layout.buildDirectory.asFile.get().path + File.separator + "distributions"
    val baseDir = File(distDir + File.separator + "tmp" + File.separator + archiveBaseName )

    archiveFileName.set("$archiveBaseName.zip")

    from(baseDir){
        into("/")
        exclude("maximo/**")
    }
}

tasks.register<Tar>("retar"){
    dependsOn("unzip")
    val archiveBaseName = project.name + "-" + project.version
    val distDir = layout.buildDirectory.asFile.get().path + File.separator + "distributions"
    val baseDir = File(distDir + File.separator + "tmp" + File.separator + archiveBaseName )

    compression = Compression.GZIP
    archiveExtension.set("tar.gz")

    from(baseDir){
        into("/")
        exclude("maximo/**")
    }
}

tasks.getByName("unzip").dependsOn("assembleDist")

tasks.jar {
    archiveFileName.set("${product.lowercase()}.jar")
}

tasks.getByName("distTar").dependsOn("jar")
tasks.getByName("distZip").dependsOn("jar")

tasks.assemble {
    finalizedBy("fixzip")
}

tasks.jar {
    manifest {
        attributes(
            mapOf(
                "Implementation-Title" to product,
                "Created-By" to vendor,
                "Implementation-Version" to project.version,
                "Main-Class" to "io.naviam.autoscript.Version"
            )
        )
    }

    archiveBaseName.set(product.lowercase())
}


publishing {
    publications {
        val outputVersionFile = project.layout.projectDirectory.file(".version")

        // Get the version string and write it to the file so the Azure DevOps pipeline can read it and include it in command line tasks
        val versionString = project.version.toString()

        // If the current branch is not main then generate a SNAPSHOT release
        val isSnapshot = getGitBranch() != "main"

        outputVersionFile.asFile.writeText(versionString + if (isSnapshot) "-SNAPSHOT" else "")

        outputVersionFile.asFile.copyTo(project.layout.projectDirectory.file("src/main/resources/autoscript-debug-version.txt").asFile, true)

        create<MavenPublication>("maven") {
            pom {
                name = "Autoscript Debug Script Driver"

                description = "An automation JSR232 driver for debugging automation scripts."
                url = "https://dev.azure.com/naviamio/Maximo%20Developer%20Tools"
                developers {
                    developer {
                        id = "chris.brown"
                        name = "Chris Brown"
                        email = "chris.brown@naviam.io"
                    }
                }
            }

            groupId = "io.naviam.maximo"
            artifactId = "autoscript-debug"
            version = versionString + if (isSnapshot) "-SNAPSHOT" else ""

            from(components["java"])
        }
    }
}

dependencies {
    implementation(fileTree("lib") { listOf("*.jar") })
    implementation("com.ibm.manage:businessobjects:9.1.283")
    implementation("org.openjdk.nashorn:nashorn-core:15.6")
    implementation("org.python:jython:2.7.4")
    implementation("com.fasterxml.jackson.core:jackson-core:2.15.2")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.2")

    implementation("org.apache.logging.log4j:log4j-core:2.17.0")

    implementation("log4j:log4j:1.2.17")
    implementation("javax.mail:javax.mail-api:1.6.2")
    implementation("javax.activation:javax.activation-api:1.2.0")
    implementation("jakarta.activation:jakarta.activation-api:2.1.4")


    testImplementation("junit:junit:4.13.2")
    testImplementation("org.python:jython-standalone:2.7.4")

//    testRuntimeOnly(
//        files(
//            fileTree("$maximoHome/lib") {
//                include("*.jar")
//            }
//        )
//    )
//    testRuntimeOnly(
//        files(
//            "$maximoHome/businessobjects/classes",
//            "$maximoHome/maximouiweb/webmodule/WEB-INF/classes"
//        )
//    )
}

fun getGitBranch(): String {
    val configuredBranch = (findProperty("sourceBranchName") as String?)?.trim()
    if (!configuredBranch.isNullOrEmpty()) {
        return configuredBranch
    }

    val process = ProcessBuilder("git", "rev-parse", "--abbrev-ref", "HEAD")
        .start()
    process.waitFor()
    return process.inputStream.bufferedReader().readText().trim()
}
